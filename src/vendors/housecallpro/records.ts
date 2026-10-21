import type { WorldCustomer } from "../../world/generate-world.ts";
import { dueAmount } from "./routes/invoice-response.ts";
import type { HcpCustomer, HcpInvoice, HcpJob } from "./types/index.ts";

/**
 * The records the seed and the scenario actions both make, built one way, so what a scenario adds looks like the
 * world's history: customers, the invoices that bill jobs, and the payments that settle them.
 */

/** One of the world's people as a customer, with their home as a service address. */
export function customerFrom(
  person: WorldCustomer,
  ids: { customer: string; address: string },
  at: string,
  notificationsEnabled: boolean,
): HcpCustomer {
  return {
    id: ids.customer,
    first_name: person.firstName,
    last_name: person.lastName,
    email: person.email,
    mobile_number: person.phone,
    home_number: null,
    work_number: null,
    company: null,
    notifications_enabled: notificationsEnabled,
    lead_source: null,
    notes: null,
    tags: [],
    addresses: [
      {
        id: ids.address,
        type: "service",
        street: person.street,
        street_line_2: null,
        city: person.city,
        state: person.state,
        zip: person.postalCode,
        country: "US",
      },
    ],
    created_at: at,
    updated_at: at,
  };
}

/**
 * A bill for a job's lines under the job's own number, sent as it is issued, and unpaid. The job's number is the one
 * the books carry (seed-work.ts), so a sync that matches invoices by number finds the right one.
 */
export function invoiceFor(
  job: HcpJob,
  id: string,
  times: { issuedAt: string; serviceDate: string | null; dueAt: string; createdAt: string },
): HcpInvoice {
  return {
    id,
    invoice_number: job.invoice_number,
    job_id: job.id,
    customer_id: job.customer_id,
    items: job.line_items,
    invoice_date: times.issuedAt,
    service_date: times.serviceDate,
    sent_at: times.issuedAt,
    due_at: times.dueAt,
    paid_at: null,
    payments: [],
    created_at: times.createdAt,
    updated_at: times.issuedAt,
  };
}

/**
 * The invoice paid in full at `at`: one payment for what is still owed. It is "external", money that didn't go
 * through Housecall Pro, since neither the world nor a scenario says how the customer paid (FIDELITY.md).
 */
export function paidInFull(invoice: HcpInvoice, paymentId: string, at: string): HcpInvoice {
  const payment = { id: paymentId, amount: dueAmount(invoice), payment_method: "external", status: "succeeded", note: null, paid_at: at };
  return { ...invoice, payments: [...invoice.payments, payment], paid_at: at, updated_at: at };
}
