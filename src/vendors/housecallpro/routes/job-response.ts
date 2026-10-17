import { linesTotal } from "../amounts.ts";
import type { HcpEmployee, HcpJob, HcpState } from "../types/index.ts";
import { employeeResponse } from "./employees.ts";
import { schedule, workAddress, workCustomer, workStatus, workTimestamps } from "./work.ts";

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
    customer: workCustomer(job.customer_id, state),
    address: workAddress(job.customer_id, job.address_id, state),
    notes: job.notes,
    work_status: workStatus(job.appointments),
    work_timestamps: workTimestamps(job.appointments),
    schedule: schedule(job.appointments, company, expand.has("appointments")),
    total_amount: total,
    outstanding_balance: outstandingBalance(job, total, state),
    subtotal: total,
    assigned_employees: assignedEmployees(job, state).map((employee) => employeeResponse(employee, company)),
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

/** What is still owed for the job: its total, less what has been paid on its invoices. */
function outstandingBalance(job: HcpJob, total: number, state: HcpState): number {
  const invoices = (state.invoicesByJob.get(job.id) ?? []).map((id) => state.invoices.get(id)!);
  const paid = invoices.flatMap((invoice) => invoice.payments).reduce((sum, payment) => sum + payment.amount, 0);
  return Math.max(0, total - paid);
}

function assignedEmployees(job: HcpJob, state: HcpState): HcpEmployee[] {
  return job.assigned_employee_ids.flatMap((id) => state.employees.get(id) ?? []);
}
