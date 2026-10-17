import { stableUuid } from "../../core/ids.ts";
import type { NewEvent } from "../../core/types.ts";
import type { World } from "../../world/generate-world.ts";
import { hcpId, hcpTime } from "./ids.ts";
import type { HcpCompany, HcpCustomer, HcpEmployee } from "./types.ts";

const SEED_TIME = hcpTime("2020-01-01T00:00:00.000Z");

/** Turns the shared world into Housecall Pro's starting records: the company, its customers, and its employees. */
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

  // The technicians are field techs, with the email address Jobber has for them, so the two can be matched.
  world.technicians.forEach((tech, index) => {
    const employee: HcpEmployee = {
      id: hcpId("pro", index + 1),
      first_name: tech.firstName,
      last_name: tech.lastName,
      email: `${tech.firstName}.${tech.lastName}.${index + 1}@example.com`.toLowerCase(),
      mobile_number: null,
      color_hex: COLORS[index % COLORS.length]!,
      avatar_url: null,
      role: "field tech",
      tags: [],
      permissions: FIELD_TECH,
      created_at: SEED_TIME,
    };
    record("EmployeeCreated", { employee });
  });

  return events;
}

/** The colors a schedule shows each employee's jobs in. */
const COLORS = ["#2f80ed", "#eb5757", "#27ae60", "#f2994a", "#9b51e0", "#56ccf2"];

/**
 * The docs list every permission but not what a field tech has by default. The twin's techs can do and be paid for
 * their own work, and nothing that runs the business (FIDELITY.md).
 */
const FIELD_TECH: HcpEmployee["permissions"] = {
  can_add_and_edit_job: true,
  can_be_booked_online: false,
  can_call_and_text_with_customers: true,
  can_chat_with_customers: true,
  can_delete_and_cancel_job: false,
  can_edit_message_on_invoice: false,
  can_see_street_view_data: true,
  can_share_job: false,
  can_take_payment_see_prices: true,
  can_see_customers: true,
  can_see_full_schedule: false,
  can_see_future_jobs: true,
  can_see_marketing_campaigns: false,
  can_see_reporting: false,
  can_edit_settings: false,
  is_point_of_contact: false,
  is_admin: false,
};

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
