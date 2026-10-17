/**
 * Housecall Pro records as the twin stores them. Names follow the public API reference, snake_case and all:
 * https://docs.housecallpro.com/docs/housecall-public-api/a4ca20a18010c-housecall-v1-api
 * Fields the world doesn't describe (a logo, a website) are null rather than made up.
 */

/** "The home services business that an employee works for." */
export interface HcpCompany {
  id: string;
  name: string;
  phone_number: string | null;
  support_email: string | null;
  logo_url: string | null;
  website: string | null;
  time_zone: string | null; // an IANA zone, like the Schedule object's time_zone
  address: HcpCompanyAddress;
  utcOffsetHours: number; // not an API field; the business's offset, for local times
}

/** The company's address, in the shape the reference calls AddressCreate. */
export interface HcpCompanyAddress {
  street: string | null;
  street_line_2: string | null;
  city: string;
  state: string;
  zip: string | null;
  country: string;
}

/** "The customer is the person who the company is performing a job for." */
export interface HcpCustomer {
  id: string;
  first_name: string | null;
  last_name: string | null;
  email: string | null;
  mobile_number: string | null;
  home_number: string | null;
  work_number: string | null;
  company: string | null;
  notifications_enabled: boolean;
  lead_source: string | null;
  notes: string | null;
  tags: string[];
  addresses: HcpAddress[]; // in the order they were added
  created_at: string;
  updated_at: string;
}

export interface HcpAddress {
  id: string;
  type: "billing" | "service";
  street: string | null;
  street_line_2: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
  country: string | null;
}

/** The text fields a client sends for a customer, all of them nullable. */
export const CUSTOMER_TEXT_FIELDS = [
  "first_name",
  "last_name",
  "email",
  "mobile_number",
  "home_number",
  "work_number",
  "company",
  "lead_source",
  "notes",
] as const;

/** "One of first_name, last_name, email, mobile_number, home_number, work_number are required." */
export const CUSTOMER_IDENTITY_FIELDS = ["first_name", "last_name", "email", "mobile_number", "home_number", "work_number"] as const;

export const ADDRESS_TEXT_FIELDS = ["street", "street_line_2", "city", "state", "zip", "country"] as const;

export interface HcpState {
  company: HcpCompany;
  // Maps keep insertion order: the order records were created, which sorts break ties by.
  customers: Map<string, HcpCustomer>;
  counts: { customers: number; addresses: number }; // how many of each have been created, to number the next one's id
}
