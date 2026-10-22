import { linesTotal } from "../amounts.ts";
import { hcpId } from "../ids.ts";
import { outstandingBalance, workStatus, workTimestamps } from "../statuses.ts";
import type { HcpCustomer, HcpJob, HcpState } from "../types/index.ts";
import { assignedEmployees, scheduleResponse, workAddress, workCustomer } from "./work-response.ts";

/**
 * A job as the API answers with it, the reference's Job object, worked out from the facts the twin keeps.
 * Get a Job: https://docs.housecallpro.com/docs/housecall-public-api/bbabd67bed1ab-get-a-job
 */
export function jobResponse(job: HcpJob, state: HcpState, expand: ReadonlySet<string>) {
  const { company } = state;
  const total = linesTotal(job.line_items);
  return {
    id: job.id,
    invoice_number: job.invoice_number,
    description: job.description,
    customer: { ...workCustomer(job.customer_id, state), notes: customerNotes(state.customers.get(job.customer_id)!) },
    address: workAddress(job.customer_id, job.address_id, state),
    notes: job.notes,
    work_status: workStatus(job.appointments),
    work_timestamps: workTimestamps(job.appointments),
    schedule: scheduleResponse(job.appointments, company, expand.has("appointments")),
    total_amount: total,
    outstanding_balance: outstandingBalance(job, state),
    subtotal: total,
    assigned_employees: assignedEmployees(job.assigned_employee_ids, state),
    tags: job.tags,
    original_estimate_id: job.original_estimate_id,
    original_estimate_uuids: job.original_estimate_id ? [job.original_estimate_id] : null, // "null unless job has been copied from an estimate"
    lead_source: job.lead_source,
    job_fields: { job_type: null, business_unit: null },
    ...(expand.has("attachments") && { attachments: [] }), // the twin keeps no files
    locked_at: null,
    created_at: job.created_at,
    updated_at: job.updated_at,
    canceled_at: null,
    deleted_at: null,
    company_name: company.name,
    company_id: company.id,
    recurrence_number: null,
    recurrence_rule: null,
    recurrence_status: null,
    recurrence_id: null,
    assigned_route_template_id: null,
  };
}

/**
 * The Job object documents its customer's `notes` as a list of Notes, where Get Customer (and the Estimate object) has
 * them as text. The twin keeps a customer's notes as text, so a job shows them as one note, with an id derived from the
 * customer's: the same every time (FIDELITY.md).
 */
function customerNotes(customer: HcpCustomer): { id: string; content: string }[] {
  return customer.notes ? [{ id: hcpId("note", `customer/${customer.id}`), content: customer.notes }] : [];
}
