import type { Hono } from "hono";
import { formatMoney, fromCents, toCents } from "../../../core/money.ts";
import { isObject } from "../../../core/request-body.ts";
import type { Twin } from "../../../core/twin.ts";
import { qboDate, qboToday } from "../dates.ts";
import { type QboFault, qboErrors } from "../errors.ts";
import { type QboInvoice, type QboPayment, type QboPaymentLine, type QboState, WRITABLE_PAYMENT_FIELDS } from "../types.ts";
import { readAmount } from "../values.ts";
import { asResponse, COMPANY, nextVersion, pickWritable, readEntityBody, type UpdateBody, writeKind } from "./entity.ts";
import { checkRequestId } from "./request-id.ts";

/**
 * Payment: https://developer.intuit.com/app/developer/qbo/docs/api/accounting/all-entities/payment
 * "The payment can be applied for a particular customer against multiple Invoices ... It can also be created
 * without any Invoice ... in which case it is recorded as a credit."
 */
export function paymentRoutes(app: Hono, twin: Twin): void {
  const state = () => twin.state<QboState>("quickbooks");
  const now = () => twin.clock.nowIso();

  app.get(`${COMPANY}/payment/:id`, (c) => {
    const payment = state().payments.get(c.req.param("id"));
    if (!payment) return c.json(qboErrors.notFound(now()), 400);
    return c.json({ Payment: asResponse(payment), time: now() });
  });

  app.post(`${COMPANY}/payment`, async (c) => {
    const body = await readEntityBody<QboPayment>(c, '{"CustomerRef": {"value": "1"}, "TotalAmt": 25}', now());
    if ("Fault" in body) return c.json(body, 400);
    const kind = writeKind(c.req.query("operation"), body, "Payment", now());
    if (typeof kind !== "string") return c.json(kind, 400);
    if (kind === "update")
      return c.json(qboErrors.unsupportedOperation("Operation update is not supported for Payment by the twin yet.", now()), 400);
    const checked = checkRequestId(c, state(), now());
    if ("answer" in checked) return checked.answer;
    const result = createPayment(twin, body, checked.requestId);
    if ("Fault" in result) return c.json(result, 400);
    return c.json({ Payment: asResponse(result), time: now() });
  });
}

function createPayment(twin: Twin, body: UpdateBody<QboPayment>, requestId: string | undefined): QboPayment | QboFault {
  const state = twin.state<QboState>("quickbooks");
  const now = twin.clock.nowIso();
  const fields = pickWritable(body, WRITABLE_PAYMENT_FIELDS);

  const TotalAmt = readAmount(fields.TotalAmt, "TotalAmt", now);
  if (typeof TotalAmt !== "number") return TotalAmt;
  if (!fields.CustomerRef?.value) return qboErrors.missingField("CustomerRef", now);
  const customer = state.customers.get(String(fields.CustomerRef.value));
  if (!customer) return qboErrors.invalidReference("CustomerRef", `Customer ${fields.CustomerRef.value}`, now);
  if (!customer.Active) return qboErrors.invalidReference("CustomerRef", `Customer ${customer.Id}, which is inactive`, now);
  const TxnDate = fields.TxnDate === undefined ? qboToday(now) : qboDate(fields.TxnDate);
  if (!TxnDate) return qboErrors.invalidDate("TxnDate", String(fields.TxnDate), now);

  // Check every line before changing anything, so a bad line never leaves a payment half-applied.
  const lines: QboPaymentLine[] = [];
  const balances = new Map<string, number>(); // invoice Id -> balance in cents, after the lines so far
  const requested: unknown = fields.Line ?? [];
  if (!Array.isArray(requested) || !requested.every(isObject)) {
    return qboErrors.invalidProperty("Line", 'Line must be a list of lines, like [{"Amount": 25, "LinkedTxn": [...]}].', now);
  }
  for (const line of requested as Partial<QboPaymentLine>[]) {
    const Amount = readAmount(line.Amount, "Line.Amount", now);
    if (typeof Amount !== "number") return Amount;
    if (line.LinkedTxn !== undefined && !Array.isArray(line.LinkedTxn)) {
      return qboErrors.invalidProperty("Line.LinkedTxn", 'LinkedTxn must be a list, like [{"TxnId": "130", "TxnType": "Invoice"}].', now);
    }
    const [link, ...more] = line.LinkedTxn ?? [];
    if (!link?.TxnId) return qboErrors.missingField("Line.LinkedTxn", now);
    if (more.length) {
      return qboErrors.unsupportedOperation("The twin applies each payment line to one invoice. Send one line per invoice.", now);
    }
    if (!link.TxnType) return qboErrors.missingField("Line.LinkedTxn.TxnType", now);
    if (link.TxnType !== "Invoice") {
      return qboErrors.unsupportedOperation(`The twin applies payments to invoices only, not to ${link.TxnType}.`, now);
    }

    const invoice = state.invoices.get(String(link.TxnId));
    if (!invoice) return qboErrors.invalidReference("Line.LinkedTxn.TxnId", `Invoice ${link.TxnId}`, now);
    if (invoice.CustomerRef.value !== customer.Id) {
      return qboErrors.businessValidation(
        `Invoice ${invoice.Id} belongs to another customer, so this payment can't be applied to it.`,
        now,
      );
    }
    const balance = (balances.get(invoice.Id) ?? toCents(invoice.Balance)) - toCents(Amount);
    if (balance < 0) {
      return qboErrors.businessValidation(
        `Invoice ${invoice.Id} has a balance of ${formatMoney(invoice.Balance)}, less than the ${formatMoney(Amount)} applied to it.`,
        now,
      );
    }
    balances.set(invoice.Id, balance);
    lines.push({ Amount, LinkedTxn: [{ TxnId: invoice.Id, TxnType: "Invoice" }] });
  }

  const unappliedCents = toCents(TotalAmt) - lines.reduce((total, line) => total + toCents(line.Amount), 0);
  if (unappliedCents < 0) {
    return qboErrors.businessValidation(`The lines apply more than the payment's TotalAmt of ${formatMoney(TotalAmt)}.`, now);
  }

  const payment: QboPayment = {
    ...fields,
    Id: String(state.nextId.Payment),
    SyncToken: "0",
    TxnDate,
    CustomerRef: { value: customer.Id, name: customer.DisplayName },
    TotalAmt,
    UnappliedAmt: fromCents(unappliedCents),
    Line: lines,
    ProcessPayment: false,
    MetaData: { CreateTime: now, LastUpdatedTime: now },
  };
  twin.record({ vendor: "quickbooks", type: "PaymentCreated", data: { payment, ...(requestId && { requestId }) } }, "api");

  // Each paid invoice changes: a lower Balance, a link to this payment, and a new SyncToken.
  for (const [invoiceId, balanceCents] of balances) {
    const existing = state.invoices.get(invoiceId)!;
    const invoice: QboInvoice = {
      ...existing,
      ...nextVersion(existing, now),
      Balance: fromCents(balanceCents),
      LinkedTxn: [...existing.LinkedTxn, { TxnId: payment.Id, TxnType: "Payment" }],
    };
    twin.record({ vendor: "quickbooks", type: "InvoiceUpdated", data: { invoice } }, "api");
  }
  return payment;
}
