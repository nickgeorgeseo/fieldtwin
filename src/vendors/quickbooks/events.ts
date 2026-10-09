import type { TwinEvent } from "../../core/types.ts";
import type { QboCustomer } from "./types.ts";

/**
 * Every event the QuickBooks twin records. Events carry complete records (the whole customer,
 * not "field X changed"), so apply() stays trivially simple and the log reads on its own.
 */
export type QboEventData =
  | { type: "CompanyCreated"; realmId: string }
  | { type: "CustomerCreated"; customer: QboCustomer }
  | { type: "CustomerUpdated"; customer: QboCustomer };

/** A logged event, narrowed to this vendor's payloads. The event's `type` tells you which one you have. */
export function asQboEvent(event: TwinEvent): QboEventData {
  return { type: event.type, ...(event.data as object) } as QboEventData;
}

/** One plain-language line per event, used by change lists and the MCP tools. */
export function describeQboEvent(event: TwinEvent): string {
  const data = asQboEvent(event);
  switch (data.type) {
    case "CompanyCreated":
      return `CompanyCreated realm ${data.realmId}`;
    case "CustomerCreated":
    case "CustomerUpdated":
      return `${data.type} Id=${data.customer.Id} "${data.customer.DisplayName}" SyncToken=${data.customer.SyncToken}`;
  }
}
