import { lineAmount } from "../amounts.ts";
import { zonedTime } from "../dates.ts";
import type { HcpAppointment, HcpCompany, HcpLineItem, HcpState } from "../types/index.ts";
import { customerResponse } from "./customers.ts";
import { employeeResponse } from "./employees.ts";
import { NOTHING_EXPANDED } from "./lists.ts";

/**
 * The parts of a job's and an estimate's answers that are the same: "An estimate functions similarly to a job; they're
 * scheduled, dispatched, and have most of the same functionality." Their statuses come from statuses.ts; this file
 * only renders what the API answers with. https://docs.housecallpro.com/docs/housecall-public-api/a4ca20a18010c-housecall-v1-api
 */

/**
 * The schedule runs from the first appointment's start to the last one's end, in UTC, and again in the company's time
 * zone with that day's offset (the `_local` fields). All null without an appointment.
 */
export function scheduleResponse(appointments: readonly HcpAppointment[], company: HcpCompany, withAppointments: boolean) {
  const first = appointments[0];
  const last = appointments.at(-1);
  const zone = first ? company.time_zone : null;
  const local = (time: string) => zonedTime(Date.parse(time), company.time_zone);
  return {
    scheduled_start: first?.start_time ?? null,
    scheduled_end: last?.end_time ?? null,
    arrival_window: first?.arrival_window_minutes ?? 0,
    time_zone: zone,
    scheduled_start_local: first ? local(first.start_time) : null,
    scheduled_end_local: last ? local(last.end_time) : null,
    ...(withAppointments && { appointments: appointments.map((appointment) => appointmentResponse(appointment, company)) }),
  };
}

/** An appointment as the API answers with it. `start_date` is the day it starts, at the company. */
export function appointmentResponse(appointment: HcpAppointment, company: HcpCompany) {
  const start = Date.parse(appointment.start_time);
  return {
    id: appointment.id,
    start_date: zonedTime(start, company.time_zone).slice(0, 10),
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

/** The employees assigned to the work, as Get Employees answers with them. */
export function assignedEmployees(employeeIds: readonly string[], state: HcpState) {
  return employeeIds.flatMap((id) => {
    const employee = state.employees.get(id);
    return employee ? [employeeResponse(employee, state.company)] : [];
  });
}

/** The address the work is at, from the customer's addresses. */
export function workAddress(customerId: string, addressId: string | null, state: HcpState) {
  return state.customers.get(customerId)!.addresses.find((address) => address.id === addressId) ?? null;
}

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
