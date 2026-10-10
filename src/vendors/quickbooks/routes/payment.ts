import type { Hono } from "hono";
import { formatMoney, fromCents, toCents } from "../../../core/money.ts";
import type { Twin } from "../../../core/twin.ts";
import { qboDate, qboToday } from "../dates.ts";
import { type QboFault, qboErrors } from "../errors.ts";
import { type QboInvoice, type QboPayment, type QboPaymentLine, type QboState, WRITABLE_PAYMENT_FIELDS } from "../types.ts";
import { asResponse, COMPANY, nextVersion, pickWritable, type UpdateBody } from "./entity.ts";
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
    const body = (await c.req.json()) as UpdateBody<QboPayment>;
    const operation = c.req.query("operation") ?? (body.Id ? "update" : undefined);
    if (operation) {
      return c.json(qboErrors.unsupportedOperation(`Operation ${operation} is not supported for Payment by the twin yet.`, now()), 400);
    }
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

  if (typeof fields.TotalAmt !== "number") return qboErrors.missingField("TotalAmt", now);
  if (fields.TotalAmt < 0) return qboErrors.negativeAmount("TotalAmt", now);
  if (!fields.CustomerRef?.value) return qboErrors.missingField("CustomerRef", now);
  const customer = state.customers.get(String(fields.CustomerRef.value));
  if (!customer?.Active) return qboErrors.invalidReference("CustomerRef", `Customer ${fields.CustomerRef.value}`, now);
  const TxnDate = fields.TxnDate === undefined ? qboToday(now) : qboDate(fields.TxnDate);
  if (!TxnDate) return qboErrors.invalidDate("TxnDate", String(fields.TxnDate), now);

  // Check every line before changing anything, so a bad line never leaves a payment half-applied.
  const lines: QboPaymentLine[] = [];
  const balances = new Map<string, number>(); // invoice Id -> balance in cents, after the lines so far
  for (const line of (fields.Line ?? []) as Partial<QboPaymentLine>[]) {
    if (typeof line.Amount !== "number") return qboErrors.missingField("Line.Amount", now);
    if (line.Amount < 0) return qboErrors.negativeAmount("Line.Amount", now);
    const [link] = line.LinkedTxn ?? [];
    if (!link?.TxnId) return qboErrors.missingField("Line.LinkedTxn", now);
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
    const balance = (balances.get(invoice.Id) ?? toCents(invoice.Balance)) - toCents(line.Amount);
    if (balance < 0) {
      return qboErrors.businessValidation(
        `Invoice ${invoice.Id} has a balance of ${formatMoney(invoice.Balance)}, less than the ${formatMoney(line.Amount)} applied to it.`,
        now,
      );
    }
    balances.set(invoice.Id, balance);
    lines.push({ Amount: line.Amount, LinkedTxn: [{ TxnId: invoice.Id, TxnType: "Invoice" }] });
  }

  const unappliedCents = toCents(fields.TotalAmt) - lines.reduce((total, line) => total + toCents(line.Amount), 0);
  if (unappliedCents < 0) {
    return qboErrors.businessValidation(`The lines apply more than the payment's TotalAmt of ${formatMoney(fields.TotalAmt)}.`, now);
  }

  const payment: QboPayment = {
    ...fields,
    Id: String(state.nextId.Payment),
    SyncToken: "0",
    TxnDate,
    CustomerRef: { value: customer.Id, name: customer.DisplayName },
    TotalAmt: fields.TotalAmt,
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
