import type { Hono } from "hono";
import type { Twin } from "../../../core/twin.ts";
import { linesTotal } from "../amounts.ts";
import { hcpError } from "../errors.ts";
import type { HcpEstimate, HcpEstimateOption, HcpState } from "../types/index.ts";
import { HCP, notFound } from "./base.ts";
import { employeeResponse } from "./employees.ts";
import { pageOf, readExpand, readList, readPaging, sorted } from "./lists.ts";
import { lineItemResponse, schedule, workAddress, workCustomer, workStatus, workTimestamps } from "./work.ts";
import { readWorkFilter } from "./work-filters.ts";

/**
 * Estimates. Get Estimates:  https://docs.housecallpro.com/docs/housecall-public-api/e430ba3d520a0-get-estimates
 *            Get one:        https://docs.housecallpro.com/docs/housecall-public-api/eae5e9c092ef2-get-a-single-estimate-by-id
 *            Option lines:   https://docs.housecallpro.com/docs/housecall-public-api/781468fb5da47-list-estimate-option-line-items
 */
export function estimateRoutes(app: Hono, twin: Twin): void {
  const state = () => twin.state<HcpState>("housecallpro");

  app.get(`${HCP}/estimates`, (c) => {
    const list = readList(c.req, { sortable: ["created_at", "updated_at", "id"], sortBy: "created_at", expandable: EXPANDABLE });
    if ("problem" in list) return c.json(hcpError(list.problem), 400);
    const matches = readWorkFilter<HcpEstimate>(c.req);
    if ("problem" in matches) return c.json(hcpError(matches.problem), 400);
    const records = sorted([...state().estimates.values()].filter(matches), list.sort, (estimate, by) => estimate[by]);
    return c.json(pageOf("estimates", records, list.paging, (estimate) => estimateResponse(estimate, state(), list.expand)));
  });

  // "Estimate not found" is the 404 message Create an estimate option documents.
  app.get(`${HCP}/estimates/:id`, (c) => {
    const estimate = state().estimates.get(c.req.param("id"));
    if (!estimate) return notFound(c, "Estimate");
    const expand = readExpand(c.req, EXPANDABLE);
    if ("problem" in expand) return c.json(hcpError(expand.problem), 400);
    return c.json(estimateResponse(estimate, state(), expand));
  });

  app.get(`${HCP}/estimates/:id/options/:optionId/line_items`, (c) => {
    const estimate = state().estimates.get(c.req.param("id"));
    if (!estimate) return notFound(c, "Estimate");
    const option = estimate.options.find((candidate) => candidate.id === c.req.param("optionId"));
    if (!option) return notFound(c, "Estimate option");
    // "page" and "page_size" are all this list documents: the lines keep the option's order.
    const paging = readPaging(c.req);
    if ("problem" in paging) return c.json(hcpError(paging.problem), 400);
    return c.json(pageOf("line_items", option.line_items.map(lineItemResponse), paging, (line) => line));
  });
}

const EXPANDABLE = ["attachments"];

/** An estimate as the API answers with it, the reference's Estimate object. */
function estimateResponse(estimate: HcpEstimate, state: HcpState, expand: ReadonlySet<string>) {
  const { company } = state;
  return {
    id: estimate.id,
    estimate_number: estimate.estimate_number,
    work_status: workStatus(estimate.appointments),
    lead_source: null,
    customer: workCustomer(estimate.customer_id, state),
    address: workAddress(estimate.customer_id, estimate.address_id, state),
    created_at: estimate.created_at,
    updated_at: estimate.updated_at,
    company_name: company.name,
    company_id: company.id,
    work_timestamps: workTimestamps(estimate.appointments),
    schedule: schedule(estimate.appointments, company, false),
    assigned_employees: estimate.assigned_employee_ids.flatMap((id) => {
      const employee = state.employees.get(id);
      return employee ? [employeeResponse(employee, company)] : [];
    }),
    estimate_fields: { job_type: null, business_unit: null },
    assigned_route_template_id: null,
    options: estimate.options.map((option) => optionResponse(option, expand)),
  };
}

/**
 * An option's approval_status is "approved" once the customer approves it and "awaiting response" once it was sent,
 * and approval_status_updated_at is when it last changed. Its status is "created job from estimate" once a job was
 * copied from it, "open" before (FIDELITY.md).
 */
function optionResponse(option: HcpEstimateOption, expand: ReadonlySet<string>) {
  return {
    id: option.id,
    name: option.name,
    option_number: option.option_number,
    total_amount: linesTotal(option.line_items),
    approval_status: option.approved_at ? "approved" : option.sent_at ? "awaiting response" : null,
    approval_status_updated_at: option.approved_at ?? option.sent_at,
    message_from_pro: null,
    tags: [],
    status: option.job_id ? "created job from estimate" : "open",
    notes: [],
    created_at: option.created_at,
    updated_at: option.updated_at,
    ...(expand.has("attachments") && { attachments: [] }),
  };
}
