import type { HcpAppointment } from "../types/index.ts";
import { listParam, oneOf, type Test, timeRange } from "./filters.ts";
import type { ListRequest } from "./lists.ts";
import { workStatus } from "./work.ts";

/** A job or an estimate: work for a customer, done on appointments. */
interface Work {
  customer_id: string;
  appointments: HcpAppointment[];
}

/**
 * The filters Get Jobs and Get Estimates document: scheduled_start_min and _max, scheduled_end_min and _max,
 * employee_ids, customer_id, and work_status ("Returns jobs from all statuses if empty"). Work without a schedule
 * matches no schedule filter.
 * https://docs.housecallpro.com/docs/housecall-public-api/6c97704da8bf3-get-jobs
 */
export function readWorkFilter<T extends Work>(req: ListRequest): Test<T> | { problem: string } {
  const tests: Test<T>[] = [];
  const problem =
    timeRange<T>(req, "scheduled_start", (work) => work.appointments[0]?.start_time, tests) ??
    timeRange<T>(req, "scheduled_end", (work) => work.appointments.at(-1)?.end_time, tests) ??
    oneOf<T>(req, "work_status", Object.keys(STATUS_FILTERS), statusFiltersOf, tests);
  if (problem) return { problem };

  const customerId = req.query("customer_id");
  if (customerId) tests.push((work) => work.customer_id === customerId);
  const employeeIds = listParam(req, "employee_ids");
  if (employeeIds.length) {
    tests.push((work) =>
      work.appointments.some((appointment) => appointment.dispatched_employees_ids.some((id) => employeeIds.includes(id))),
    );
  }
  return (work) => tests.every((test) => test(work));
}

/**
 * The filter's work statuses are not the Job's own: `completed` finds "complete rated" and "complete unrated" work,
 * `unscheduled` finds "needs scheduling", and `canceled` finds "user canceled" and "pro canceled".
 */
const STATUS_FILTERS: Record<string, string[]> = {
  unscheduled: ["needs scheduling"],
  scheduled: ["scheduled"],
  in_progress: ["in progress"],
  completed: ["complete rated", "complete unrated"],
  canceled: ["user canceled", "pro canceled"],
};

function statusFiltersOf(work: Work): string[] {
  const status = workStatus(work.appointments);
  return Object.keys(STATUS_FILTERS).filter((filter) => STATUS_FILTERS[filter]!.includes(status));
}
