import { stableUuid } from "../../core/ids.ts";
import type { NewEvent } from "../../core/types.ts";
import type { World } from "../../world/generate-world.ts";
import type { HcpCompany } from "./types.ts";

/** Turns the shared world into Housecall Pro's starting records. */
export function seedHousecallPro(world: World): NewEvent[] {
  const { name, city, state, utcOffsetHours } = world.company;
  const company: HcpCompany = {
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
  return [{ vendor: "housecallpro", type: "CompanyCreated", data: { company } }];
}

/** The IANA zone of each state the world's cities are in (world/word-lists.ts). */
const TIME_ZONES: Record<string, string> = {
  GA: "America/New_York",
  NC: "America/New_York",
  SC: "America/New_York",
  TX: "America/Chicago",
};
