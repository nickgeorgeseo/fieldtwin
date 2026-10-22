import type { Hono } from "hono";
import { readJsonObject } from "../../../core/request-body.ts";
import type { Twin } from "../../../core/twin.ts";
import { hcpTime } from "../dates.ts";
import { hcpError } from "../errors.ts";
import { hcpId } from "../ids.ts";
import type { HcpJob, HcpState } from "../types/index.ts";
import { HCP } from "./base.ts";
import { readJobRequest } from "./job-body.ts";
import { jobResponse } from "./job-response.ts";
import { NOTHING_EXPANDED } from "./lists.ts";

/** Create a Job: https://docs.housecallpro.com/docs/housecall-public-api/2dcf481ed7d69-create-a-job */
export function jobWriteRoutes(app: Hono, twin: Twin): void {
  const state = () => twin.state<HcpState>("housecallpro");

  app.post(`${HCP}/jobs`, async (c) => {
    const read = await readJsonObject(c, '{"customer_id": "cus_...", "address_id": "adr_..."}');
    if ("problem" in read) return c.json(hcpError(read.problem), 400);
    const request = readJobRequest(read.body, state());
    if ("problem" in request) return c.json(hcpError(request.problem), request.status);

    const invoiceNumber = request.invoice_number ?? nextInvoiceNumber(state());
    if (invoiceNumber === undefined) {
      const problem = `invoice_number: the highest number taken is ${Number.MAX_SAFE_INTEGER}, the largest the twin can count to. Send one.`;
      return c.json(hcpError(problem), 422);
    }

    const { counts } = state();
    const now = hcpTime(twin.clock.nowIso());
    const job: HcpJob = {
      id: hcpId("job", counts.jobs + 1),
      invoice_number: invoiceNumber,
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
              start_time: request.schedule.scheduled_start,
              end_time: request.schedule.scheduled_end,
              arrival_window_minutes: request.schedule.arrival_window,
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

/**
 * "If left blank, one will be automatically generated": the twin takes the number after the highest so far, or none
 * past the largest whole number it can count to exactly.
 */
function nextInvoiceNumber(state: HcpState): string | undefined {
  const numbers = [...state.jobs.values()].map((job) => Number(job.invoice_number)).filter(Number.isInteger);
  const next = Math.max(0, ...numbers) + 1;
  return Number.isSafeInteger(next) ? String(next) : undefined;
}
