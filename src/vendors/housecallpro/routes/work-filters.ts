import { readTime } from "../dates.ts";
import type { HcpJob } from "../types.ts";
import { workStatus } from "./job-response.ts";
import type { ListRequest } from "./lists.ts";

/**
 * The filters Get Jobs documents: scheduled_start_min and _max, scheduled_end_min and _max (each "greater than or
 * equal to" or "less than or equal to the date sent"), employee_ids, customer_id, and work_status ("Returns jobs from
 * all statuses if empty"). A job without a schedule matches no schedule filter.
 * https://docs.housecallpro.com/docs/housecall-public-api/6c97704da8bf3-get-jobs
 */
export function readJobFilter(req: ListRequest): ((job: HcpJob) => boolean) | { problem: string } {
  const times: [string, (job: HcpJob) => string | undefined, "min" | "max"][] = [
    ["scheduled_start_min", (job) => job.appointments[0]?.start_time, "min"],
    ["scheduled_start_max", (job) => job.appointments[0]?.start_time, "max"],
    ["scheduled_end_min", (job) => job.appointments.at(-1)?.end_time, "min"],
    ["scheduled_end_max", (job) => job.appointments.at(-1)?.end_time, "max"],
  ];
  const tests: ((job: HcpJob) => boolean)[] = [];
  for (const [name, read, bound] of times) {
    const value = req.query(name);
    if (!value) continue;
    const limit = readTime(value);
    if (limit === undefined)
      return { problem: `${name} must be a date or a date and time in UTC, like 2026-07-13T15:30:00, not "${value}".` };
    tests.push((job) => {
      const time = read(job);
      if (time === undefined) return false;
      return bound === "min" ? Date.parse(time) >= limit : Date.parse(time) <= limit;
    });
  }

  const customerId = req.query("customer_id");
  if (customerId) tests.push((job) => job.customer_id === customerId);

  const employeeIds = listParam(req, "employee_ids");
  if (employeeIds.length) {
    tests.push((job) =>
      job.appointments.some((appointment) => appointment.dispatched_employees_ids.some((id) => employeeIds.includes(id))),
    );
  }

  const statuses = listParam(req, "work_status");
  const unknown = statuses.find((status) => !(status in STATUS_FILTERS));
  if (unknown !== undefined) return { problem: `work_status takes ${Object.keys(STATUS_FILTERS).join(", ")}, not "${unknown}".` };
  if (statuses.length) tests.push((job) => statuses.some((status) => STATUS_FILTERS[status]!.includes(workStatus(job))));

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

/** A list in the query string, as `name[]=a&name[]=b` (what Rails clients send) or `name=a`. */
function listParam(req: ListRequest, name: string): string[] {
  return [...(req.queries(`${name}[]`) ?? []), ...(req.queries(name) ?? [])].filter(Boolean);
}
