import { isObject } from "../../../core/request-body.ts";
import { ADDRESS_TEXT_FIELDS, CUSTOMER_IDENTITY_FIELDS, CUSTOMER_TEXT_FIELDS, type HcpAddress, type HcpCustomer } from "../types.ts";

/**
 * Reading the customer and address fields a client sends (the reference's CustomerCreate, CustomerUpdate, and
 * AddressCreate). Text fields are strings or null, as the reference types them. Fields the twin doesn't model are
 * dropped, like a field Housecall Pro doesn't know. Every problem names the field, so the request can be fixed.
 */

export type CustomerFields = Partial<Pick<HcpCustomer, (typeof CUSTOMER_TEXT_FIELDS)[number] | "notifications_enabled" | "tags">>;
export type AddressFields = Omit<HcpAddress, "id" | "type">;

type Read<T> = T | { problem: string };

/** The customer fields in `body`, or what's wrong with them. */
export function readCustomerFields(body: Record<string, unknown>): Read<CustomerFields> {
  const fields: CustomerFields = {};
  for (const name of CUSTOMER_TEXT_FIELDS) {
    if (!(name in body)) continue;
    const value = body[name];
    if (value !== null && typeof value !== "string") return { problem: `${name} must be a string or null, not ${JSON.stringify(value)}.` };
    fields[name] = value;
  }
  if ("notifications_enabled" in body) {
    if (typeof body.notifications_enabled !== "boolean") {
      return { problem: `notifications_enabled must be true or false, not ${JSON.stringify(body.notifications_enabled)}.` };
    }
    fields.notifications_enabled = body.notifications_enabled;
  }
  if ("tags" in body) {
    const { tags } = body;
    if (!Array.isArray(tags) || !tags.every((tag) => typeof tag === "string")) {
      return { problem: `tags must be a list of strings, like ["vip"], not ${JSON.stringify(tags)}.` };
    }
    fields.tags = tags;
  }
  return fields;
}

/** Every text field empty: where a new customer starts, before the fields a client sent. */
export function noCustomerText(): Record<(typeof CUSTOMER_TEXT_FIELDS)[number], null> {
  return Object.fromEntries(CUSTOMER_TEXT_FIELDS.map((name) => [name, null])) as Record<(typeof CUSTOMER_TEXT_FIELDS)[number], null>;
}

/** The addresses sent with a new customer, or what's wrong with them. CustomerCreate requires none of their fields. */
export function readAddressList(value: unknown): Read<AddressFields[]> {
  if (value === undefined) return [];
  if (!Array.isArray(value)) return { problem: `addresses must be a list of addresses, not ${JSON.stringify(value)}.` };
  const addresses: AddressFields[] = [];
  for (const [index, entry] of value.entries()) {
    const address = readAddress(entry, `addresses[${index}]`);
    if ("problem" in address) return address;
    addresses.push(address);
  }
  return addresses;
}

/** One address, or what's wrong with it. `path` says where it was in the request, for the message. */
export function readAddress(value: unknown, path: string): Read<AddressFields> {
  if (!isObject(value)) return { problem: `${path} must be an address object, like {"street": "12 Elm St", "city": "Riverton"}.` };
  const address = Object.fromEntries(ADDRESS_TEXT_FIELDS.map((name) => [name, null])) as AddressFields;
  for (const name of ADDRESS_TEXT_FIELDS) {
    const field = value[name];
    if (field === undefined) continue;
    if (field !== null && typeof field !== "string")
      return { problem: `${path}.${name} must be a string or null, not ${JSON.stringify(field)}.` };
    address[name] = field;
  }
  return address;
}

/** "One of first_name, last_name, email, mobile_number, home_number, work_number are required." */
export function identityProblem(customer: CustomerFields): string | undefined {
  if (CUSTOMER_IDENTITY_FIELDS.some((name) => customer[name]?.trim())) return undefined;
  return "A customer needs at least one of first_name, last_name, email, mobile_number, home_number, or work_number.";
}
