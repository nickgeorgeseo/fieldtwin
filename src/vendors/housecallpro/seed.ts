import { stableUuid } from "../../core/ids.ts";
import type { NewEvent } from "../../core/types.ts";
import type { World } from "../../world/generate-world.ts";
import { hcpId, hcpTime } from "./ids.ts";
import type { HcpCompany, HcpCustomer } from "./types.ts";

const SEED_TIME = hcpTime("2020-01-01T00:00:00.000Z");

/** Turns the shared world into Housecall Pro's starting records: the company and its customers. */
export function seedHousecallPro(world: World): NewEvent[] {
  const events: NewEvent[] = [{ vendor: "housecallpro", type: "CompanyCreated", data: { company: company(world) } }];
  const record = (type: string, data: object) => events.push({ vendor: "housecallpro", type, data });

  // Housecall Pro is a field-service system, like Jobber: customers who exist only in the books aren't here, and
  // everyone is spelled the way the field-service system has them (see world/drift.ts).
  const people = world.customers.filter((person) => !world.drift.accountingOnly.includes(person.key));
  people.forEach((person, index) => {
    const customer: HcpCustomer = {
      id: hcpId("cus", index + 1),
      first_name: person.firstName,
      last_name: person.lastName,
      email: person.email,
      mobile_number: person.phone,
      home_number: null,
      work_number: null,
      company: null,
      notifications_enabled: true,
      lead_source: null,
      notes: null,
      tags: [],
      addresses: [
        {
          id: hcpId("adr", index + 1),
          type: "service",
          street: person.street,
          street_line_2: null,
          city: person.city,
          state: person.state,
          zip: person.postalCode,
          country: "US",
        },
      ],
      created_at: SEED_TIME,
      updated_at: SEED_TIME,
    };
    record("CustomerCreated", { customer });
  });

  return events;
}

function company(world: World): HcpCompany {
  const { name, city, state, utcOffsetHours } = world.company;
  return {
    id: stableUuid("housecallpro/company"), // the docs don't show a company id's format; a UUID is the plainest guess
    name,
    phone_number: null,
    support_email: null,
    logo_url: null,
    website: null,
    time_zone: TIME_ZONES[state] ?? null,
    address: { street: null, street_line_2: null, city, state, zip: null, country: "US" },
    utcOffsetHours,
  };
}

/** The IANA zone of each state the world's cities are in (world/word-lists.ts). */
const TIME_ZONES: Record<string, string> = {
  GA: "America/New_York",
  NC: "America/New_York",
  SC: "America/New_York",
  TX: "America/Chicago",
};
