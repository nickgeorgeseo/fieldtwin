/**
 * Housecall Pro's work as the twin stores it: jobs, estimates, and invoices. Names follow the public API reference:
 * https://docs.housecallpro.com/docs/housecall-public-api/a4ca20a18010c-housecall-v1-api
 * Money is in cents, as the API sends it. Statuses aren't stored: routes work them out from these facts.
 */

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

/**
 * "An estimate functions similarly to a job; they're scheduled, dispatched, and have most of the same functionality.
 * If an estimate is approved, it can be copied to a job." Its options are the choices a customer approves or declines.
 */
export interface HcpEstimate {
  id: string;
  estimate_number: string;
  customer_id: string;
  address_id: string | null;
  appointments: HcpAppointment[]; // a site visit to look at the work; the world's quotes never had one
  options: HcpEstimateOption[];
  created_at: string;
  updated_at: string;
}

export interface HcpEstimateOption {
  id: string;
  name: string;
  option_number: string;
  line_items: HcpLineItem[];
  sent_at: string | null; // not an API field: sent to the customer, from when it awaits a response
  approved_at: string | null; // not an API field: when the customer approved it
  job_id: string | null; // not an API field: the job copied from it
  created_at: string;
  updated_at: string;
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
