import { localTime } from "../../../core/local-time.ts";
import { lineAmount } from "../amounts.ts";
import { zonedTime } from "../dates.ts";
import type { HcpAppointment, HcpCompany, HcpLineItem, HcpState } from "../types/index.ts";
import { customerResponse } from "./customers.ts";

/**
 * What jobs and estimates share: "An estimate functions similarly to a job; they're scheduled, dispatched, and have
 * most of the same functionality." Both keep facts (appointments, and when their work was done), and the API's
 * statuses and schedules are worked out from them here.
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

/**
 * The schedule runs from the first appointment's start to the last one's end, in UTC, and again in the company's time
 * zone with that day's offset (the `_local` fields). All null without an appointment.
 */
export function schedule(appointments: readonly HcpAppointment[], company: HcpCompany, withAppointments: boolean) {
  const first = appointments[0];
  const last = appointments.at(-1);
  const zone = first ? company.time_zone : null;
  const local = (time: string) => zonedTime(Date.parse(time), zone!);
  return {
    scheduled_start: first?.start_time ?? null,
    scheduled_end: last?.end_time ?? null,
    arrival_window: first?.arrival_window_minutes ?? 0,
    time_zone: zone,
    scheduled_start_local: first && zone ? local(first.start_time) : null,
    scheduled_end_local: last && zone ? local(last.end_time) : null,
    ...(withAppointments && { appointments: appointments.map((appointment) => appointmentResponse(appointment, company)) }),
  };
}

/** An appointment as the API answers with it. `start_date` is the day it starts, at the company. */
export function appointmentResponse(appointment: HcpAppointment, company: HcpCompany) {
  const start = Date.parse(appointment.start_time);
  return {
    id: appointment.id,
    start_date: (company.time_zone ? zonedTime(start, company.time_zone) : localTime(start, company.utcOffsetHours)).slice(0, 10),
    start_time: appointment.start_time,
    end_time: appointment.end_time,
    anytime: false,
    arrival_window_minutes: appointment.arrival_window_minutes,
    dispatched_employees_ids: appointment.dispatched_employees_ids,
  };
}

/** The customer the work is for, as Get Customer answers with it but without addresses, which the Job's customer lacks. */
export function workCustomer(customerId: string, state: HcpState) {
  const { addresses: _, ...customer } = customerResponse(state.customers.get(customerId)!, state.company, NOTHING_EXPANDED);
  return customer;
}

/** The address the work is at, from the customer's addresses. */
export function workAddress(customerId: string, addressId: string | null, state: HcpState) {
  return state.customers.get(customerId)!.addresses.find((address) => address.id === addressId) ?? null;
}

const NOTHING_EXPANDED = new Set<string>();

/** A line item as the line item lists answer with it (the reference's LineItemResponse). */
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
