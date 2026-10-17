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
  };
}

/** The only place Housecall Pro state changes. */
export function applyHcpEvent(state: HcpState, event: TwinEvent): void {
  const data = asHcpEvent(event);

  switch (data.type) {
    case "CompanyCreated":
      state.company = data.company;
      return;

    default:
      throw new Error(`Housecall Pro twin does not know how to apply "${event.type}"`);
  }
}
