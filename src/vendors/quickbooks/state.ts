import type { TwinEvent } from "../../core/types.ts";
import { asQboEvent } from "./events.ts";
import type { QboCustomer, QboEntityName, QboState } from "./types.ts";

export function createQboState(): QboState {
  return { realmId: "", customers: new Map(), items: new Map(), nextId: { Customer: 1, Item: 1 } };
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
      return;

    case "ItemCreated":
      state.items.set(data.item.Id, data.item);
      claimId(state, "Item", data.item.Id);
      return;

    default:
      throw new Error(`QuickBooks twin does not know how to apply "${event.type}"`);
  }
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
