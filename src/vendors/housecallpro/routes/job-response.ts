import { localTime } from "../../../core/local-time.ts";
import { lineAmount, linesTotal } from "../amounts.ts";
import type { HcpAppointment, HcpCompany, HcpEmployee, HcpJob, HcpLineItem, HcpState } from "../types.ts";
import { customerResponse } from "./customers.ts";
import { employeeResponse } from "./employees.ts";

/**
 * A job as the API answers with it, the reference's Job object, worked out from the facts the twin keeps.
 * Get a Job: https://docs.housecallpro.com/docs/housecall-public-api/bbabd67bed1ab-get-a-job
 */
export function jobResponse(job: HcpJob, state: HcpState, expand: ReadonlySet<string>) {
  const { company } = state;
  const customer = state.customers.get(job.customer_id)!;
  const { addresses: _, ...customerFields } = customerResponse(customer, company, NOTHING_EXPANDED); // the Job's customer has none
  const total = linesTotal(job.line_items);
  return {
    id: job.id,
    invoice_number: job.invoice_number,
    description: job.description,
    customer: customerFields,
    address: customer.addresses.find((address) => address.id === job.address_id) ?? null,
    notes: job.notes,
    work_status: workStatus(job),
    work_timestamps: workTimestamps(job),
    schedule: schedule(job, company, expand.has("appointments")),
    total_amount: total,
    outstanding_balance: outstandingBalance(job, total, state),
    subtotal: total,
    assigned_employees: assignedEmployees(job, state).map((employee) => employeeResponse(employee, company)),
    tags: job.tags,
    original_estimate_id: job.original_estimate_id,
    original_estimate_uuids: job.original_estimate_id ? [job.original_estimate_id] : null, // "null unless job has been copied from an estimate"
    lead_source: job.lead_source,
    job_fields: { job_type: null, business_unit: null },
    ...(expand.has("attachments") && { attachments: [] }), // the twin keeps no files
    locked_at: null,
    created_at: job.created_at,
    updated_at: job.updated_at,
    canceled_at: null,
    deleted_at: null,
    company_name: company.name,
    company_id: company.id,
    recurrence_number: null,
    recurrence_rule: null,
    recurrence_status: null,
    recurrence_id: null,
    assigned_route_template_id: null,
  };
}

const NOTHING_EXPANDED = new Set<string>();

/** What is still owed for the job: its total, less what has been paid on its invoices. */
function outstandingBalance(job: HcpJob, total: number, state: HcpState): number {
  const invoices = (state.invoicesByJob.get(job.id) ?? []).map((id) => state.invoices.get(id)!);
  const paid = invoices.flatMap((invoice) => invoice.payments).reduce((sum, payment) => sum + payment.amount, 0);
  return Math.max(0, total - paid);
}

/**
 * A job's work_status, from the work done: "needs scheduling" without an appointment, "complete unrated" once every
 * appointment's work is done (the twin has no customer ratings), "in progress" once some is, "scheduled" before then.
 * Time passing never finishes a job: someone marks the work done, so a job whose time has passed stays "scheduled".
 */
export function workStatus(job: HcpJob): "needs scheduling" | "scheduled" | "in progress" | "complete unrated" {
  const done = job.appointments.filter((appointment) => appointment.completed_at).length;
  if (job.appointments.length === 0) return "needs scheduling";
  if (done === job.appointments.length) return "complete unrated";
  return done > 0 ? "in progress" : "scheduled";
}

/** When the work started (the first appointment's start, once any is done) and finished (once all are). */
function workTimestamps(job: HcpJob) {
  const status = workStatus(job);
  const started = status === "in progress" || status === "complete unrated";
  const finished = job.appointments.map((appointment) => appointment.completed_at ?? "").sort();
  return {
    on_my_way_at: null,
    started_at: started ? job.appointments[0]!.start_time : null,
    completed_at: status === "complete unrated" ? finished.at(-1)! : null,
  };
}

/**
 * The job's schedule runs from its first appointment's start to its last one's end, in UTC, and again in the
 * company's time zone (the `_local` fields), which are null for an unscheduled job.
 */
function schedule(job: HcpJob, company: HcpCompany, withAppointments: boolean) {
  const first = job.appointments[0];
  const last = job.appointments.at(-1);
  const zone = first ? company.time_zone : null;
  const local = (time: string) => localTime(Date.parse(time), company.utcOffsetHours);
  return {
    scheduled_start: first?.start_time ?? null,
    scheduled_end: last?.end_time ?? null,
    arrival_window: first?.arrival_window_minutes ?? 0,
    time_zone: zone,
    scheduled_start_local: first && zone ? local(first.start_time) : null,
    scheduled_end_local: last && zone ? local(last.end_time) : null,
    ...(withAppointments && { appointments: job.appointments.map((appointment) => appointmentResponse(appointment, company)) }),
  };
}

/** An appointment as the API answers with it. `start_date` is the day it starts, at the company. */
export function appointmentResponse(appointment: HcpAppointment, company: HcpCompany) {
  return {
    id: appointment.id,
    start_date: localTime(Date.parse(appointment.start_time), company.utcOffsetHours).slice(0, 10),
    start_time: appointment.start_time,
    end_time: appointment.end_time,
    anytime: false,
    arrival_window_minutes: appointment.arrival_window_minutes,
    dispatched_employees_ids: appointment.dispatched_employees_ids,
  };
}

/** Everyone dispatched to any of the job's appointments, in the order they first appear. */
export function assignedEmployees(job: HcpJob, state: HcpState): HcpEmployee[] {
  const ids = new Set(job.appointments.flatMap((appointment) => appointment.dispatched_employees_ids));
  return [...ids].flatMap((id) => state.employees.get(id) ?? []);
}

/** A line item as Lists all line items for a job answers with it (the reference's LineItemResponse). */
export function lineItemResponse(line: HcpLineItem, index: number) {
  return {
    ...line,
    unit_of_measure: null,
    amount: lineAmount(line),
    order_index: index,
    service_item_id: null, // the twin's line items aren't from a price book
    service_item_type: null,
  };
}
