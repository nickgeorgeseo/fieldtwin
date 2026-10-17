import type { TwinEvent } from "../../core/types.ts";
import type { HcpAddress, HcpCompany, HcpCustomer } from "./types.ts";

/** Every event the Housecall Pro twin records. Events carry complete records, so apply() stays simple. */
export type HcpEventData =
  | { type: "CompanyCreated"; company: HcpCompany }
  | { type: "CustomerCreated"; customer: HcpCustomer }
  | { type: "CustomerUpdated"; customer: HcpCustomer }
  | { type: "AddressCreated"; customerId: string; address: HcpAddress };

/** A logged event, narrowed to this vendor's payloads. The event's `type` tells you which one you have. */
export function asHcpEvent(event: TwinEvent): HcpEventData {
  return { type: event.type, ...(event.data as object) } as HcpEventData;
}

/** One plain-language line per event, used by change lists and the MCP tools. */
export function describeHcpEvent(event: TwinEvent): string {
  const data = asHcpEvent(event);
  switch (data.type) {
    case "CompanyCreated":
      return `CompanyCreated "${data.company.name}"`;
    case "CustomerCreated":
    case "CustomerUpdated":
      return `${data.type} ${data.customer.id} "${customerName(data.customer)}"`;
    case "AddressCreated":
      return `AddressCreated ${data.address.id} for ${data.customerId} "${[data.address.street, data.address.city].filter(Boolean).join(", ")}"`;
  }
}

/** How a person reads a customer: their name, or failing that their company, email, or a phone number. */
export function customerName(customer: HcpCustomer): string {
  const name = [customer.first_name, customer.last_name].filter(Boolean).join(" ");
  return name || customer.company || customer.email || customer.mobile_number || customer.home_number || customer.work_number || "";
}
