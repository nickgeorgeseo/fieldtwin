import { stableUuid } from "../../core/ids.ts";
import type { NewEvent } from "../../core/types.ts";
import type { World } from "../../world/generate-world.ts";
import { CITIES } from "../../world/word-lists.ts";
import { hcpTime } from "./dates.ts";
import { SeedIds } from "./seed-ids.ts";
import { seedWork } from "./seed-work.ts";
import type { HcpCompany, HcpCustomer, HcpEmployee } from "./types/index.ts";

const SEED_TIME = hcpTime("2020-01-01T00:00:00.000Z");

/** Turns the shared world into Housecall Pro's starting records: the company, its people, and its work history. */
export function seedHousecallPro(world: World): NewEvent[] {
  const ids = new SeedIds(world);
  const events: NewEvent[] = [{ vendor: "housecallpro", type: "CompanyCreated", data: { company: company(world) } }];
  const record = (type: string, data: object) => events.push({ vendor: "housecallpro", type, data });

  // Housecall Pro is a field-service system, like Jobber: customers who exist only in the books aren't here, and
  // everyone is spelled the way the field-service system has them (see world/drift.ts).
  for (const key of ids.customerKeys()) {
    const person = world.customers.find((candidate) => candidate.key === key)!;
    const customer: HcpCustomer = {
      id: ids.customer(key),
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
          id: ids.address(key),
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
  }

  // The technicians are field techs, with the email address the world gives them, so Jobber's users match them.
  world.technicians.forEach((tech, index) => {
    const employee: HcpEmployee = {
      id: ids.employee(tech.key),
      first_name: tech.firstName,
      last_name: tech.lastName,
      email: tech.email,
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

  events.push(...seedWork(world, ids));
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
  const { name, city, state, street, postalCode, phone } = world.company;
  return {
    id: stableUuid("housecallpro/company"), // the docs don't show a company id's format; a UUID is the plainest guess
    name,
    phone_number: phone,
    support_email: null,
    logo_url: null,
    website: null,
    time_zone: CITIES.find((home) => home.city === city)!.timeZone, // the city's IANA zone, daylight saving and all
    address: { street, street_line_2: null, city, state, zip: postalCode, country: "US" },
  };
}
