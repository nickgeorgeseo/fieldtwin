import { linesTotal } from "./amounts.ts";
import type { HcpAppointment, HcpInvoice, HcpJob, HcpState } from "./types/index.ts";

/**
 * Statuses and balances are derived, not stored: the twin keeps facts (appointments and when their work was done,
 * an invoice's lines and payments) and works out the API's work_status, invoice status, and amounts owed from them on
 * every read, so routes, scenario actions, and webhooks all agree. "An estimate functions similarly to a job; they're
 * scheduled, dispatched, and have most of the same functionality", so both derive their work_status the same way.
 * https://docs.housecallpro.com/docs/housecall-public-api/a4ca20a18010c-housecall-v1-api
 */

export type WorkStatus = "needs scheduling" | "scheduled" | "in progress" | "complete unrated";

/**
 * The work_status, from the work done: "needs scheduling" without an appointment, "complete unrated" once every
 * appointment's work is done (the twin has no customer ratings), "in progress" once some is, "scheduled" before then.
 * Time passing never finishes the work: someone marks it done, so work whose time has passed stays "scheduled".
 */
export function workStatus(appointments: readonly HcpAppointment[]): WorkStatus {
  const done = appointments.filter((appointment) => appointment.completed_at).length;
  if (appointments.length === 0) return "needs scheduling";
  if (done === appointments.length) return "complete unrated";
  return done > 0 ? "in progress" : "scheduled";
}

/** When the work started (the first appointment's start, once any is done) and finished (once all of it is). */
export function workTimestamps(appointments: readonly HcpAppointment[]) {
  const status = workStatus(appointments);
  const started = status === "in progress" || status === "complete unrated";
  const finished = appointments.map((appointment) => appointment.completed_at ?? "").sort();
  return {
    on_my_way_at: null,
    started_at: started ? appointments[0]!.start_time : null,
    completed_at: status === "complete unrated" ? finished.at(-1)! : null,
  };
}

/** What the invoice's payments haven't covered, in cents. */
export function dueAmount(invoice: HcpInvoice): number {
  const paid = invoice.payments.reduce((total, payment) => total + payment.amount, 0);
  return Math.max(0, linesTotal(invoice.items) - paid);
}

/**
 * "paid" once payments cover it, "open" before. The other statuses the filter names (pending_payment, voided,
 * uncollectible, canceled) need writes the twin doesn't model yet.
 */
export function invoiceStatus(invoice: HcpInvoice): "open" | "paid" {
  return dueAmount(invoice) === 0 ? "paid" : "open";
}

/** What is still owed for the job: its total, less what has been paid on its invoices. */
export function outstandingBalance(job: HcpJob, state: HcpState): number {
  const invoices = (state.invoicesByJob.get(job.id) ?? []).map((id) => state.invoices.get(id)!);
  const paid = invoices.flatMap((invoice) => invoice.payments).reduce((sum, payment) => sum + payment.amount, 0);
  return Math.max(0, linesTotal(job.line_items) - paid);
}
