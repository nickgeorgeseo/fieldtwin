import type { TwinEvent } from "../../core/types.ts";
import { asHcpEvent } from "./events.ts";
import type { HcpState } from "./types.ts";

export function createHcpState(): HcpState {
  return {
    company: {
      id: "",
      name: "",
      phone_number: null,
      support_email: null,
      logo_url: null,
      website: null,
      time_zone: null,
      address: { street: null, street_line_2: null, city: "", state: "", zip: null, country: "US" },
      utcOffsetHours: 0,
    },
    customers: new Map(),
    counts: { customers: 0, addresses: 0 },
  };
}

/** The only place Housecall Pro state changes. */
export function applyHcpEvent(state: HcpState, event: TwinEvent): void {
  const data = asHcpEvent(event);

  switch (data.type) {
    case "CompanyCreated":
      state.company = data.company;
      return;

    case "CustomerCreated":
      state.customers.set(data.customer.id, data.customer);
      state.counts.customers += 1;
      state.counts.addresses += data.customer.addresses.length;
      return;

    case "CustomerUpdated":
      state.customers.set(data.customer.id, data.customer);
      return;

    case "AddressCreated": {
      // Records are replaced, not edited, so a customer read earlier stays as it was read.
      const customer = state.customers.get(data.customerId)!;
      state.customers.set(customer.id, { ...customer, addresses: [...customer.addresses, data.address] });
      state.counts.addresses += 1;
      return;
    }

    default:
      throw new Error(`Housecall Pro twin does not know how to apply "${event.type}"`);
  }
}
