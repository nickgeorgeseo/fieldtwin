import type { ScenarioAction } from "../../core/vendor-twin.ts";
import { newCustomer } from "../../world/generate-world.ts";
import { customerName } from "./events.ts";
import { hcpId, hcpTime } from "./ids.ts";
import { dueAmount } from "./routes/invoice-response.ts";
import type { HcpCustomer, HcpInvoice, HcpJob, HcpPayment, HcpState } from "./types/index.ts";

/**
 * What a scenario timeline can make happen in Housecall Pro, as if a Pro did it in the app. Each returns complete
 * events; the twin records them with source "scenario" when the entry is due.
 *
 *   housecallpro: { newCustomers: 15 }   fifteen new customers call in or book online
 *   housecallpro: { completeJobs: 3 }    techs finish the three jobs whose visits began first
 *   housecallpro: { payInvoices: 2 }     customers pay the two invoices due longest ago, in full
 */
export const housecallproScenarioActions: Record<string, ScenarioAction<HcpState>> = {
  newCustomers: {
    check: (count) => checkCount("newCustomers", count),
    run: (count, { state, world, random, nowIso }) => {
      // Customers the books have and Housecall Pro doesn't (drift's accountingOnly) are taken too, so emails never clash.
      const taken = new Set([...state.customers.values()].map(customerName));
      for (const person of world.customers) taken.add(`${person.firstName} ${person.lastName}`);
      const now = hcpTime(nowIso);
      return Array.from({ length: count as number }, (_, index) => {
        const number = state.counts.customers + 1 + index;
        const person = newCustomer(random, world, number, taken);
        taken.add(`${person.firstName} ${person.lastName}`);
        const customer: HcpCustomer = {
          id: hcpId("cus", number),
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
    check: (count) => checkCount("completeJobs", count),
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

  // One payment for what is still owed, so the invoice is "paid". It is "external", like the world's payments: a
  // scenario doesn't say how the customer paid (FIDELITY.md).
  payInvoices: {
    check: (count) => checkCount("payInvoices", count),
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

function checkCount(action: string, value: unknown): void {
  if (!Number.isInteger(value) || (value as number) < 1) {
    throw new Error(`housecallpro ${action} takes how many: a whole number of 1 or more, not ${JSON.stringify(value)}`);
  }
}
