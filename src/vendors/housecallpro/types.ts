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

/** "A job is the work that is done for a customer by an employee." */
export interface HcpJob {
  id: string;
  invoice_number: string; // "must be unique across all of a company's jobs"
  description: string;
  customer_id: string;
  address_id: string | null;
  line_items: HcpLineItem[];
  appointments: HcpAppointment[]; // in the order they happen; the job's schedule runs from the first to the last
  original_estimate_id: string | null; // the estimate it was copied from
  tags: string[];
  notes: { id: string; content: string }[];
  lead_source: string | null;
  created_at: string;
  updated_at: string;
}

/** A line on a job, an invoice, or an estimate option. Prices are in cents: "Unit price in cents (e.g., 10000 = $100.00)". */
export interface HcpLineItem {
  id: string;
  name: string;
  description: string | null;
  unit_price: number;
  unit_cost: number;
  quantity: number; // "can be a float up to two decimal places"
  kind: "labor" | "materials" | "fixed gratuity" | "fixed discount" | "percent discount";
  taxable: boolean;
}

/** A visit to the customer's property to do a job's work. */
export interface HcpAppointment {
  id: string;
  start_time: string;
  end_time: string;
  arrival_window_minutes: number;
  dispatched_employees_ids: string[];
  completed_at: string | null; // not an API field: when the work was marked done, which decides the job's work_status
}

/** A bill for a job's work. The job's own number is the invoice's (FIDELITY.md). */
export interface HcpInvoice {
  id: string;
  invoice_number: string;
  job_id: string;
  customer_id: string; // not an API field: whom the invoice bills, for the customer_uuid filter
  items: HcpLineItem[]; // the job's lines, as invoiced
  invoice_date: string;
  service_date: string | null;
  sent_at: string | null;
  due_at: string;
  paid_at: string | null;
  payments: HcpPayment[];
  created_at: string; // not an API field: what the list sorts by default
  updated_at: string;
}

export interface HcpPayment {
  id: string;
  amount: number; // cents
  payment_method: string;
  status: string;
  note: string | null;
  paid_at: string;
}

export const ADDRESS_TEXT_FIELDS = ["street", "street_line_2", "city", "state", "zip", "country"] as const;

export interface HcpState {
  company: HcpCompany;
  // Maps keep insertion order: the order records were created, which sorts break ties by.
  customers: Map<string, HcpCustomer>;
  employees: Map<string, HcpEmployee>;
  jobs: Map<string, HcpJob>;
  invoices: Map<string, HcpInvoice>;
  invoicesByJob: Map<string, string[]>; // a job's invoice ids, kept by apply() so a job never searches every invoice
  // How many of each have been created, to number the next one's id (ids.ts).
  counts: {
    customers: number;
    addresses: number;
    jobs: number;
    lineItems: number;
    appointments: number;
    invoices: number;
    payments: number;
  };
}
