import type { Hono } from "hono";
import { formatMoney, fromCents, toCents } from "../../../core/money.ts";
import type { Twin } from "../../../core/twin.ts";
import { type QboFault, qboErrors } from "../errors.ts";
import { draftInvoice, type InvoiceFields } from "../invoice-rules.ts";
import { type QboInvoice, type QboState, WRITABLE_INVOICE_FIELDS } from "../types.ts";
import { asResponse, COMPANY, checkSyncToken, mergeUpdate, nextVersion, pickWritable, type UpdateBody } from "./entity.ts";

/** Invoice: https://developer.intuit.com/app/developer/qbo/docs/api/accounting/all-entities/invoice */
export function invoiceRoutes(app: Hono, twin: Twin): void {
  const state = () => twin.state<QboState>("quickbooks");
  const now = () => twin.clock.nowIso();

  app.get(`${COMPANY}/invoice/:id`, (c) => {
    const invoice = state().invoices.get(c.req.param("id"));
    if (!invoice) return c.json(qboErrors.notFound(now()), 400);
    return c.json({ Invoice: asResponse(invoice), time: now() });
  });

  // One POST endpoint for create and update; an Id in the body means update.
  app.post(`${COMPANY}/invoice`, async (c) => {
    const operation = c.req.query("operation");
    if (operation) {
      return c.json(qboErrors.unsupportedOperation(`Operation ${operation} is not supported for Invoice by the twin yet.`, now()), 400);
    }
    const body = (await c.req.json()) as UpdateBody<QboInvoice>;
    const result = body.Id ? updateInvoice(twin, body) : createInvoice(twin, body);
    if ("Fault" in result) return c.json(result, 400);
    return c.json({ Invoice: asResponse(result), time: now() });
  });
}

function createInvoice(twin: Twin, body: UpdateBody<QboInvoice>): QboInvoice | QboFault {
  const state = twin.state<QboState>("quickbooks");
  const now = twin.clock.nowIso();
  const fields: InvoiceFields = pickWritable(body, WRITABLE_INVOICE_FIELDS);

  const draft = draftInvoice(state, fields, { today: now.slice(0, 10), now, isCreate: true });
  if ("Fault" in draft) return draft;

  const invoice: QboInvoice = {
    ...draft,
    Id: String(state.nextId.Invoice),
    SyncToken: "0",
    Balance: draft.TotalAmt, // "Initially set to the value of TotalAmt"
    LinkedTxn: [],
    MetaData: { CreateTime: now, LastUpdatedTime: now },
  };
  twin.record({ vendor: "quickbooks", type: "InvoiceCreated", data: { invoice } }, "api");
  return invoice;
}

function updateInvoice(twin: Twin, body: UpdateBody<QboInvoice>): QboInvoice | QboFault {
  const state = twin.state<QboState>("quickbooks");
  const now = twin.clock.nowIso();
  const existing = state.invoices.get(String(body.Id));
  if (!existing) return qboErrors.notFound(now);

  const conflict = checkSyncToken(existing, body, now);
  if (conflict) return conflict;

  const fields: InvoiceFields = mergeUpdate(existing, body, WRITABLE_INVOICE_FIELDS);
  const draft = draftInvoice(state, fields, { today: now.slice(0, 10), now, existingLines: existing.Line, isCreate: false });
  if ("Fault" in draft) return draft;

  // Payments already applied stay applied, so the new balance is the new total minus what has been paid.
  const paidCents = toCents(existing.TotalAmt) - toCents(existing.Balance);
  const balanceCents = toCents(draft.TotalAmt) - paidCents;
  if (balanceCents < 0) {
    return qboErrors.businessValidation(
      `This invoice has ${formatMoney(fromCents(paidCents))} in payments applied, so its total can't go below that.`,
      now,
    );
  }

  const invoice: QboInvoice = {
    ...draft,
    ...nextVersion(existing, now),
    Balance: fromCents(balanceCents),
    LinkedTxn: existing.LinkedTxn, // read only: payment links survive updates
  };
  twin.record({ vendor: "quickbooks", type: "InvoiceUpdated", data: { invoice } }, "api");
  return invoice;
}
