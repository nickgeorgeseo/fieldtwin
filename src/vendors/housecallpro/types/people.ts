/**
 * Housecall Pro's people as the twin stores them: the company, its customers, and its employees. Names follow the
 * public API reference: https://docs.housecallpro.com/docs/housecall-public-api/a4ca20a18010c-housecall-v1-api
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
  time_zone: string; // an IANA zone, like the Schedule object's time_zone
  address: HcpCompanyAddress;
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

/** How a person reads a customer: their name, or failing that their company, email, or a phone number. */
export function customerName(customer: HcpCustomer): string {
  const name = [customer.first_name, customer.last_name].filter(Boolean).join(" ");
  return name || customer.company || customer.email || customer.mobile_number || customer.home_number || customer.work_number || "";
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

/** "An Employee is a person working for the business using Housecall Pro": a field tech or an office admin. */
export interface HcpEmployee {
  id: string;
  first_name: string;
  last_name: string;
  email: string;
  mobile_number: string | null;
  color_hex: string;
  avatar_url: string | null;
  role: string; // "field tech" in the webhook samples
  tags: string[];
  permissions: Record<(typeof EMPLOYEE_PERMISSIONS)[number], boolean>;
  created_at: string;
}

/** Every permission the Employee object lists. */
export const EMPLOYEE_PERMISSIONS = [
  "can_add_and_edit_job",
  "can_be_booked_online",
  "can_call_and_text_with_customers",
  "can_chat_with_customers",
  "can_delete_and_cancel_job",
  "can_edit_message_on_invoice",
  "can_see_street_view_data",
  "can_share_job",
  "can_take_payment_see_prices",
  "can_see_customers",
  "can_see_full_schedule",
  "can_see_future_jobs",
  "can_see_marketing_campaigns",
  "can_see_reporting",
  "can_edit_settings",
  "is_point_of_contact",
  "is_admin",
] as const;

export const ADDRESS_TEXT_FIELDS = ["street", "street_line_2", "city", "state", "zip", "country"] as const;
