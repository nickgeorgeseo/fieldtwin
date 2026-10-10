import type { TwinEvent } from "../../core/types.ts";
import { asQboEvent } from "./events.ts";
import type { QboAnswer, QboCustomer, QboEntityName, QboState } from "./types.ts";

export function createQboState(): QboState {
  return {
    realmId: "",
    customers: new Map(),
    items: new Map(),
    invoices: new Map(),
    payments: new Map(),
    nextId: { Customer: 1, Item: 1, Invoice: 1, Payment: 1 },
    answered: new Map(),
  };
}

/** The only place QuickBooks state changes. Events carry complete records, so this stays simple. */
export function applyQboEvent(state: QboState, event: TwinEvent): void {
  const data = asQboEvent(event);

  switch (data.type) {
    case "CompanyCreated":
      state.realmId = data.realmId;
      return;

    case "CustomerCreated":
    case "CustomerUpdated":
      state.customers.set(data.customer.Id, data.customer);
      claimId(state, "Customer", data.customer.Id);
      remember(state, data.requestId, { entity: "Customer", record: data.customer, time: event.at });
      return;

    case "ItemCreated":
      state.items.set(data.item.Id, data.item);
      claimId(state, "Item", data.item.Id);
      return;

    case "InvoiceCreated":
    case "InvoiceUpdated":
      state.invoices.set(data.invoice.Id, data.invoice);
      claimId(state, "Invoice", data.invoice.Id);
      remember(state, data.requestId, { entity: "Invoice", record: data.invoice, time: event.at });
      return;

    case "PaymentCreated":
      state.payments.set(data.payment.Id, data.payment);
      claimId(state, "Payment", data.payment.Id);
      remember(state, data.requestId, { entity: "Payment", record: data.payment, time: event.at });
      return;

    default:
      throw new Error(`QuickBooks twin does not know how to apply "${event.type}"`);
  }
}

/** A write that sent a requestid: keep its answer, so a repeat of the request gets the same one. */
function remember(state: QboState, requestId: string | undefined, answer: QboAnswer): void {
  if (requestId !== undefined) state.answered.set(requestId, answer);
}

/** Keep each entity's Id sequence ahead of every Id it has handed out. */
function claimId(state: QboState, entity: QboEntityName, id: string): void {
  state.nextId[entity] = Math.max(state.nextId[entity], Number(id) + 1);
}

/** Helper for routes: the record a CustomerCreated event should carry. */
export function newCustomerRecord(state: QboState, fields: Partial<QboCustomer> & { DisplayName: string }, now: string): QboCustomer {
  return {
    Active: true,
    ...fields,
    Id: String(state.nextId.Customer),
    SyncToken: "0",
    MetaData: { CreateTime: now, LastUpdatedTime: now },
  };
}
