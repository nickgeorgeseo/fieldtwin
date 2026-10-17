import type { Hono } from "hono";
import type { Twin } from "../../../core/twin.ts";
import { hcpError } from "../errors.ts";
import type { HcpJob, HcpState } from "../types/index.ts";
import { HCP } from "./base.ts";
import { notFound } from "./customers.ts";
import { jobResponse } from "./job-response.ts";
import { pageOf, readExpand, readList, sorted } from "./lists.ts";
import { appointmentResponse, lineItemResponse, workStatus } from "./work.ts";
import { readWorkFilter } from "./work-filters.ts";

/**
 * Jobs. Get Jobs:          https://docs.housecallpro.com/docs/housecall-public-api/6c97704da8bf3-get-jobs
 *       Get a Job:         https://docs.housecallpro.com/docs/housecall-public-api/bbabd67bed1ab-get-a-job
 *       Line items:        https://docs.housecallpro.com/docs/housecall-public-api/1c84b6c79b94f-lists-all-line-items-for-a-job
 *       Get Appointments:  https://docs.housecallpro.com/docs/housecall-public-api/512e91c37033f-get-appointments
 */
export function jobRoutes(app: Hono, twin: Twin): void {
  const state = () => twin.state<HcpState>("housecallpro");

  app.get(`${HCP}/jobs`, (c) => {
    const list = readList(c.req, { sortable: SORTABLE, sortBy: "created_at", expandable: EXPANDABLE });
    if ("problem" in list) return c.json(hcpError(list.problem), 400);
    const matches = readWorkFilter<HcpJob>(c.req);
    if ("problem" in matches) return c.json(hcpError(matches.problem), 400);
    const records = sorted([...state().jobs.values()].filter(matches), list.sort, sortValue);
    return c.json(pageOf("jobs", records, list.paging, (job) => jobResponse(job, state(), list.expand)));
  });

  // "job not found" is the message Lock Job documents for a job that doesn't exist.
  app.get(`${HCP}/jobs/:id`, (c) => {
    const job = state().jobs.get(c.req.param("id"));
    if (!job) return notFound(c, "job");
    const expand = readExpand(c.req, EXPANDABLE);
    if ("problem" in expand) return c.json(hcpError(expand.problem), 400);
    return c.json(jobResponse(job, state(), expand));
  });

  // The answer names its own path in `url`, beside the lines in `data`.
  app.get(`${HCP}/jobs/:id/line_items`, (c) => {
    const job = state().jobs.get(c.req.param("id"));
    if (!job) return notFound(c, "job");
    return c.json({ url: `/jobs/${job.id}/line_items`, data: job.line_items.map(lineItemResponse) });
  });

  app.get(`${HCP}/jobs/:id/appointments`, (c) => {
    const job = state().jobs.get(c.req.param("id"));
    if (!job) return notFound(c, "job");
    return c.json({ appointments: job.appointments.map((appointment) => appointmentResponse(appointment, state().company)) });
  });
}

const SORTABLE = ["created_at", "updated_at", "invoice_number", "id", "description", "work_status"] as const;
const EXPANDABLE = ["attachments", "appointments"];

function sortValue(job: HcpJob, by: (typeof SORTABLE)[number]): string {
  return by === "work_status" ? workStatus(job.appointments) : job[by];
}
