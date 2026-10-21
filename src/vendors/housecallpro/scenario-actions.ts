import { checkCount, type ScenarioAction } from "../../core/vendor-twin.ts";
import { MOST_NEW_CUSTOMERS, newCustomers } from "../../world/generate-world.ts";
import { NET_DAYS } from "../../world/history-stories.ts";
import { linesTotal } from "./amounts.ts";
import { customerName } from "./events.ts";
import { hcpId, hcpTime } from "./ids.ts";
import { dueAmount } from "./routes/invoice-response.ts";
import { workTimestamps } from "./routes/work.ts";
import type { HcpCustomer, HcpInvoice, HcpJob, HcpPayment, HcpState } from "./types/index.ts";

/**
 * What a scenario timeline can make happen in Housecall Pro, as if a Pro did it in the app. Each returns complete
 * events; the twin records them with source "scenario" when the entry is due.
 *
 *   housecallpro: { newCustomers: 15 }   fifteen new customers call in or book online
 *   housecallpro: { completeJobs: 3 }    techs finish the three jobs whose visits began first
 *   housecallpro: { invoiceJobs: 2 }     the Pro invoices the two jobs finished longest ago
 *   housecallpro: { payInvoices: 2 }     customers pay the two invoices due longest ago, in full
 */
export const housecallproScenarioActions: Record<string, ScenarioAction<HcpState>> = {
  newCustomers: {
    check: (count) => checkCount("housecallpro", "newCustomers", count, MOST_NEW_CUSTOMERS),
    run: (count, { state, world, random, nowIso }) => {
      const now = hcpTime(nowIso);
      const firstNumber = state.counts.customers + 1;
      const people = newCustomers(random, world, firstNumber, count as number, [...state.customers.values()].map(customerName));
      return people.map((person, index) => {
        const customer: HcpCustomer = {
          id: hcpId("cus", firstNumber + index),
          first_name: person.firstName,
          last_name: person.lastName,
          email: person.email,
          mobile_number: person.phone,
          home_number: null,
          work_number: null,
          company: null,
          notifications_enabled: false, // as for one created through the API: the twin never assumes a customer agreed to messages
          lead_source: null,
          notes: null,
          tags: [],
          addresses: [
            {
              id: hcpId("adr", state.counts.addresses + 1 + index),
              type: "service",
              street: person.street,
              street_line_2: null,
              city: person.city,
              state: person.state,
              zip: person.postalCode,
              country: "US",
            },
          ],
          created_at: now,
          updated_at: now,
        };
        return { vendor: "housecallpro", type: "CustomerCreated", data: { customer } };
      });
    },
  },

  // A tech marks the work done, and the job is "complete unrated" (routes/work.ts). Only work whose time has come is
  // finished: a job with a visit still ahead waits for it, so no job is done before it was due to start.
  completeJobs: {
    check: (count) => checkCount("housecallpro", "completeJobs", count),
    run: (count, { state, nowIso }) => {
      const now = hcpTime(nowIso);
      return [...state.jobs.values()]
        .map((job) => ({ job, left: job.appointments.filter((appointment) => !appointment.completed_at) }))
        .filter(({ left }) => left.length > 0 && left.every((appointment) => Date.parse(appointment.start_time) <= Date.parse(nowIso)))
        .sort((a, b) => Date.parse(a.left[0]!.start_time) - Date.parse(b.left[0]!.start_time))
        .slice(0, count as number)
        .map(({ job }) => {
          const appointments = job.appointments.map((appointment) => ({ ...appointment, completed_at: appointment.completed_at ?? now }));
          const completed: HcpJob = { ...job, appointments, updated_at: now };
          return { vendor: "housecallpro", type: "JobUpdated", data: { job: completed } };
        });
    },
  },

  // A Pro invoices finished work and sends it at once, as the world's invoices were sent: the job's lines under the
  // job's own number, as seed-work.ts bills them, due on the world's terms (FIDELITY.md). The fields are Get Invoices':
  // https://docs.housecallpro.com/docs/housecall-public-api/65ce9f430d605-get-invoices
  // Work with nothing to bill is left: a $0 invoice would be paid with no payment, and the docs don't say what then.
  invoiceJobs: {
    check: (count) => checkCount("housecallpro", "invoiceJobs", count),
    run: (count, { state, nowIso }) => {
      const now = hcpTime(nowIso);
      const dueAt = hcpTime(new Date(Date.parse(nowIso) + NET_DAYS * DAY_MS).toISOString());
      return [...state.jobs.values()]
        .flatMap((job) => {
          const finished = workTimestamps(job.appointments).completed_at;
          const billable = finished && !state.invoicesByJob.has(job.id) && linesTotal(job.line_items) > 0;
          return billable ? [{ job, finished }] : [];
        })
        .sort((a, b) => Date.parse(a.finished) - Date.parse(b.finished))
        .slice(0, count as number)
        .map(({ job, finished }, index) => {
          const invoice: HcpInvoice = {
            id: hcpId("invoice", state.counts.invoices + 1 + index),
            invoice_number: job.invoice_number,
            job_id: job.id,
            customer_id: job.customer_id,
            items: job.line_items,
            invoice_date: now,
            service_date: finished,
            sent_at: now,
            due_at: dueAt,
            paid_at: null,
            payments: [],
            created_at: now,
            updated_at: now,
          };
          return { vendor: "housecallpro", type: "InvoiceCreated", data: { invoice } };
        });
    },
  },

  // One payment for what is still owed, so the invoice is "paid". It is "external", like the world's payments: a
  // scenario doesn't say how the customer paid (FIDELITY.md).
  payInvoices: {
    check: (count) => checkCount("housecallpro", "payInvoices", count),
    run: (count, { state, nowIso }) => {
      const now = hcpTime(nowIso);
      return [...state.invoices.values()]
        .filter((invoice) => dueAmount(invoice) > 0)
        .sort((a, b) => Date.parse(a.due_at) - Date.parse(b.due_at))
        .slice(0, count as number)
        .map((invoice, index) => {
          const payment: HcpPayment = {
            id: hcpId("pmt", state.counts.payments + 1 + index),
            amount: dueAmount(invoice),
            payment_method: "external",
            status: "succeeded",
            note: null,
            paid_at: now,
          };
          const paid: HcpInvoice = { ...invoice, payments: [...invoice.payments, payment], paid_at: now, updated_at: now };
          return { vendor: "housecallpro", type: "InvoiceUpdated", data: { invoice: paid } };
        });
    },
  },
};

const DAY_MS = 86_400_000;
