import type { Hono } from "hono";
import { readJsonObject } from "../../../core/request-body.ts";
import type { Twin } from "../../../core/twin.ts";
import { hcpError } from "../errors.ts";
import { hcpId, hcpTime } from "../ids.ts";
import type { HcpJob, HcpState } from "../types/index.ts";
import { HCP } from "./base.ts";
import { readJobRequest } from "./job-body.ts";
import { jobResponse } from "./job-response.ts";

/** Create a Job: https://docs.housecallpro.com/docs/housecall-public-api/2dcf481ed7d69-create-a-job */
export function jobWriteRoutes(app: Hono, twin: Twin): void {
  const state = () => twin.state<HcpState>("housecallpro");

  app.post(`${HCP}/jobs`, async (c) => {
    const read = await readJsonObject(c, '{"customer_id": "cus_...", "address_id": "adr_..."}');
    if ("problem" in read) return c.json(hcpError(read.problem), 400);
    const request = readJobRequest(read.body, state());
    if ("problem" in request) return c.json(hcpError(request.problem), request.status);

    const { counts } = state();
    const now = hcpTime(twin.clock.nowIso());
    const job: HcpJob = {
      id: hcpId("job", counts.jobs + 1),
      invoice_number: request.invoice_number ?? nextInvoiceNumber(state()),
      description: null,
      customer_id: request.customer_id,
      address_id: request.address_id,
      line_items: request.line_items.map((line, index) => ({ id: hcpId("li", counts.lineItems + 1 + index), ...line })),
      assigned_employee_ids: request.assigned_employee_ids,
      // A scheduled job is one appointment, with the job's employees dispatched to it.
      appointments: request.schedule
        ? [
            {
              id: hcpId("appt", counts.appointments + 1),
              start_time: request.schedule.start,
              end_time: request.schedule.end,
              arrival_window_minutes: request.schedule.arrivalWindow,
              dispatched_employees_ids: request.assigned_employee_ids,
              completed_at: null,
            },
          ]
        : [],
      original_estimate_id: null,
      tags: request.tags,
      notes: request.notes === undefined ? [] : [{ id: hcpId("note", counts.notes + 1), content: request.notes }],
      lead_source: request.lead_source,
      created_at: now,
      updated_at: now,
    };
    twin.record({ vendor: "housecallpro", type: "JobCreated", data: { job } }, "api");
    return c.json(jobResponse(job, state(), NOTHING_EXPANDED), 201);
  });
}

const NOTHING_EXPANDED = new Set<string>();

/** "If left blank, one will be automatically generated": the twin takes the number after the highest so far. */
function nextInvoiceNumber(state: HcpState): string {
  const numbers = [...state.jobs.values()].map((job) => Number(job.invoice_number)).filter(Number.isInteger);
  return String(Math.max(0, ...numbers) + 1);
}
