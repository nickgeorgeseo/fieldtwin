import type { TwinEvent } from "../../core/types.ts";
import type { QboCustomer, QboEventData, QboState } from "./types.ts";

export function createQboState(): QboState {
  return { realmId: "", customers: new Map(), nextId: 1 };
}

/** The only place QuickBooks state changes. Events carry complete records, so this stays simple. */
export function applyQboEvent(state: QboState, event: TwinEvent): void {
  const data = { type: event.type, ...(event.data as object) } as QboEventData;

  switch (data.type) {
    case "CompanyCreated":
      state.realmId = data.realmId;
      return;

    case "CustomerCreated":
    case "CustomerUpdated":
      state.customers.set(data.customer.Id, data.customer);
      state.nextId = Math.max(state.nextId, Number(data.customer.Id) + 1);
      return;

    default:
      throw new Error(`QuickBooks twin does not know how to apply "${event.type}"`);
  }
}

/** Helper for routes: the record a CustomerCreated event should carry. */
export function newCustomerRecord(state: QboState, fields: Partial<QboCustomer> & { DisplayName: string }, now: string): QboCustomer {
  return {
    Active: true,
    ...fields,
    Id: String(state.nextId),
    SyncToken: "0",
    MetaData: { CreateTime: now, LastUpdatedTime: now },
  };
}
