import type { HcpJob } from "../types.ts";
import { listParam, oneOf, type Test, timeRange } from "./filters.ts";
import { workStatus } from "./job-response.ts";
import type { ListRequest } from "./lists.ts";

/**
 * The filters Get Jobs documents: scheduled_start_min and _max, scheduled_end_min and _max, employee_ids, customer_id,
 * and work_status ("Returns jobs from all statuses if empty"). A job without a schedule matches no schedule filter.
 * https://docs.housecallpro.com/docs/housecall-public-api/6c97704da8bf3-get-jobs
 */
export function readJobFilter(req: ListRequest): Test<HcpJob> | { problem: string } {
  const tests: Test<HcpJob>[] = [];
  const problem =
    timeRange<HcpJob>(req, "scheduled_start", (job) => job.appointments[0]?.start_time, tests) ??
    timeRange<HcpJob>(req, "scheduled_end", (job) => job.appointments.at(-1)?.end_time, tests) ??
    oneOf<HcpJob>(req, "work_status", Object.keys(STATUS_FILTERS), (job) => statusFiltersOf(job), tests);
  if (problem) return { problem };

  const customerId = req.query("customer_id");
  if (customerId) tests.push((job) => job.customer_id === customerId);
  const employeeIds = listParam(req, "employee_ids");
  if (employeeIds.length) {
    tests.push((job) =>
      job.appointments.some((appointment) => appointment.dispatched_employees_ids.some((id) => employeeIds.includes(id))),
    );
  }
  return (job) => tests.every((test) => test(job));
}

/**
 * The filter's work statuses are not the Job's own: `completed` finds "complete rated" and "complete unrated" jobs,
 * `unscheduled` finds "needs scheduling" ones, and `canceled` the "user canceled" and "pro canceled" ones.
 */
const STATUS_FILTERS: Record<string, string[]> = {
  unscheduled: ["needs scheduling"],
  scheduled: ["scheduled"],
  in_progress: ["in progress"],
  completed: ["complete rated", "complete unrated"],
  canceled: ["user canceled", "pro canceled"],
};

function statusFiltersOf(job: HcpJob): string[] {
  const status = workStatus(job);
  return Object.keys(STATUS_FILTERS).filter((filter) => STATUS_FILTERS[filter]!.includes(status));
}
