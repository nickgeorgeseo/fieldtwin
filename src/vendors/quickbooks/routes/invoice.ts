import type { Hono } from "hono";
import type { Twin } from "../../../core/twin.ts";
import { type QboFault, qboErrors } from "../errors.ts";
import { draftInvoice, type InvoiceFields } from "../invoice-rules.ts";
import { type QboInvoice, type QboState, WRITABLE_INVOICE_FIELDS } from "../types.ts";
import { asResponse, COMPANY, pickWritable, type UpdateBody } from "./entity.ts";

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
    const result = body.Id ? updateNotYet(now()) : createInvoice(twin, body);
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

function updateNotYet(now: string): QboFault {
  return qboErrors.unsupportedOperation("Operation Update is not supported for Invoice by the twin yet.", now);
}
