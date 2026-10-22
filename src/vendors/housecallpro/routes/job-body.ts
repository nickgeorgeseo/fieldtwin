import { readUtcTime } from "../../../core/clock.ts";
import { isObject, shown } from "../../../core/request-body.ts";
import { hcpTimeAt } from "../dates.ts";
import type { HcpState } from "../types/index.ts";
import { type Refusal, refuse, withoutNulls } from "./body.ts";
import { type LineFields, readLineItems } from "./line-item-body.ts";

/**
 * Reading a Create a Job request (the reference's JobCreate): "Create a job with the ID for an already existing
 * address and customer." https://docs.housecallpro.com/docs/housecall-public-api/2dcf481ed7d69-create-a-job
 */
export interface JobRequest {
  customer_id: string;
  address_id: string;
  invoice_number: string | undefined; // undefined: "one will be automatically generated"
  schedule: { scheduled_start: string; scheduled_end: string; arrival_window: number } | undefined; // the docs' names
  assigned_employee_ids: string[];
  line_items: LineFields[];
  tags: string[];
  lead_source: string | null;
  notes: string | undefined;
}

/** The job a request asks for, or why the twin can't make it: 422 for the request, 404 for what it names, 501 for the twin. */
export function readJobRequest(body: Record<string, unknown>, state: HcpState): JobRequest | Refusal {
  const missing = ["customer_id", "address_id"].filter((name) => typeof body[name] !== "string" || !body[name]);
  if (missing.length)
    return refuse(`A job needs ${missing.join(" and ")}: "Create a job with the ID for an already existing address and customer."`);

  const customer = state.customers.get(body.customer_id as string);
  if (!customer) return refuse("customer not found", 404);
  if (!customer.addresses.some((address) => address.id === body.address_id)) return refuse("address not found", 404);
  const employees = body.assigned_employee_ids ?? [];
  if (!Array.isArray(employees) || !employees.every((id) => typeof id === "string"))
    return refuse("assigned_employee_ids must be a list of employee ids.");
  if (employees.some((id) => !state.employees.has(id))) return refuse("employee not found", 404);
  // After the lookups, like the other 501s: a record that doesn't exist is the client's to fix before the twin's gaps matter.
  const fields = body.job_fields;
  if (isObject(fields) && (fields.job_type_id != null || fields.business_unit_id != null)) {
    return refuse("job_fields: the twin doesn't model job types or business units yet.", 501);
  }

  const invoiceNumber = readInvoiceNumber(body.invoice_number, state);
  if ("problem" in invoiceNumber) return invoiceNumber;
  const schedule = readSchedule(body.schedule);
  if (schedule && "problem" in schedule) return schedule;
  const lines = readLineItems(body.line_items);
  if ("problem" in lines) return lines;
  // null on an optional field means it wasn't sent, as clients generated from the OpenAPI spec send it.
  const { tags = [], lead_source = null, notes = undefined } = withoutNulls(body);
  if (!Array.isArray(tags) || !tags.every((tag) => typeof tag === "string"))
    return refuse(`tags must be a list of strings, like ["warranty"].`);
  if (lead_source !== null && typeof lead_source !== "string") return refuse("lead_source must be a string.");
  if (notes !== undefined && typeof notes !== "string") return refuse("notes must be a string.");

  return {
    customer_id: customer.id,
    address_id: body.address_id as string,
    invoice_number: invoiceNumber.value,
    schedule,
    assigned_employee_ids: [...new Set(employees as string[])],
    line_items: lines,
    tags,
    lead_source,
    notes: notes?.trim() ? notes : undefined,
  };
}

/** "Invoice number must be unique across all of a company's jobs in Housecall Pro." A number, as JobCreate types it. */
function readInvoiceNumber(sent: unknown, state: HcpState): { value: string | undefined } | Refusal {
  if (sent === undefined || sent === null) return { value: undefined };
  // Digits in a string work too ("6001"), as answers write the number and Rails would read it (FIDELITY.md).
  const value = typeof sent === "string" && /^\d+$/.test(sent) ? Number(sent) : sent;
  // A safe integer, so it prints as digits ("5000", never "1e+21") and the number after it is one more.
  if (!Number.isSafeInteger(value) || (value as number) < 1) {
    return refuse(`invoice_number must be a whole number from 1 to ${Number.MAX_SAFE_INTEGER}, not ${shown(sent)}.`);
  }
  const taken = [...state.jobs.values()].some((job) => job.invoice_number === String(value));
  if (taken) return refuse(`invoice_number ${value} is taken: it must be unique across all of a company's jobs.`);
  return { value: String(value) };
}

/** A schedule is a start and an end ("ISO-8601 formatted date string", UTC unless it says otherwise), end after start. */
function readSchedule(value: unknown): JobRequest["schedule"] | Refusal {
  if (value === undefined || value === null) return undefined;
  if (!isObject(value))
    return refuse('schedule must be an object, like {"scheduled_start": "2026-07-20T14:00:00", "scheduled_end": "2026-07-20T16:00:00"}.');
  if (value.anytime === true) return refuse("schedule.anytime: the twin doesn't model anytime schedules yet.", 501);
  const times: number[] = [];
  for (const name of ["scheduled_start", "scheduled_end"]) {
    const text = value[name];
    const ms = typeof text === "string" ? readUtcTime(text) : undefined;
    if (ms === undefined)
      return refuse(`schedule.${name} is required, as an ISO-8601 date and time like 2026-07-20T14:00:00, not ${shown(text)}.`);
    // Before standard time, a zone's offset had seconds in it (Chicago's was -05:50:36), which no ISO-8601 offset can
    // write, so the _local times would be wrong. No real job is scheduled that long ago.
    if (new Date(ms).getUTCFullYear() < 1900) return refuse(`schedule.${name} must be in 1900 or later, not ${shown(text)}.`);
    times.push(ms);
  }
  // Times are kept to the second (hcpTime), so compare them as kept: 14:00:00.1 to 14:00:00.9 would be no time at all.
  const [start, end] = (times as [number, number]).map((ms) => Math.floor(ms / 1000) * 1000) as [number, number];
  if (end <= start) return refuse("schedule.scheduled_end must be after schedule.scheduled_start, by a second or more.");
  const { arrival_window = 0 } = withoutNulls(value);
  // A safe integer, so it is written as digits (never 1e+21) and a client can read it back as a whole number.
  if (!Number.isSafeInteger(arrival_window) || (arrival_window as number) < 0)
    return refuse(`schedule.arrival_window must be whole minutes of 0 or more, not ${shown(arrival_window)}.`);
  return { scheduled_start: hcpTimeAt(start), scheduled_end: hcpTimeAt(end), arrival_window: arrival_window as number };
}
