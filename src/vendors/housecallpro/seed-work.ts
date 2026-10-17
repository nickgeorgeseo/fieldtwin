import type { NewEvent } from "../../core/types.ts";
import type { World } from "../../world/generate-world.ts";
import type { WorldLineItem } from "../../world/history.ts";
import { linesTotal } from "./amounts.ts";
import { hcpTime } from "./ids.ts";
import type { SeedIds } from "./seed-ids.ts";
import type { HcpInvoice, HcpJob, HcpLineItem } from "./types.ts";

/**
 * The business's work history in Housecall Pro: each of the world's jobs, with a visit as an appointment, and the
 * invoices for them. Records keep facts (when each appointment's work was done, when an invoice was paid), and the API
 * derives statuses from them (routes/job-response.ts, routes/invoice-response.ts).
 */
export function seedWork(world: World, ids: SeedIds): NewEvent[] {
  const events: NewEvent[] = [];
  const jobs = new Map<string, HcpJob>();
  for (const worldJob of world.history.jobs) {
    const job: HcpJob = {
      id: ids.numbered("job", worldJob.key),
      invoice_number: String(worldJob.number),
      description: worldJob.title,
      customer_id: ids.customer(worldJob.customerKey),
      address_id: ids.address(worldJob.customerKey),
      line_items: lineItems(worldJob.lineItems, world, ids),
      appointments: worldJob.visits.map((visit) => ({
        id: ids.next("appt"),
        start_time: hcpTime(visit.startAt),
        end_time: hcpTime(visit.endAt),
        arrival_window_minutes: 0,
        dispatched_employees_ids: visit.technicianKeys.map((key) => ids.employee(key)),
        completed_at: visit.completedAt ? hcpTime(visit.completedAt) : null,
      })),
      original_estimate_id: worldJob.quoteKey ? ids.numbered("est", worldJob.quoteKey) : null,
      tags: [],
      notes: [],
      lead_source: null,
      created_at: hcpTime(worldJob.createdAt),
      updated_at: hcpTime(worldJob.visits.at(-1)?.completedAt ?? worldJob.createdAt),
    };
    jobs.set(worldJob.key, job);
    events.push({ vendor: "housecallpro", type: "JobCreated", data: { job } });
  }

  // An invoice bills the job's lines under the job's own number. A paid one has a payment for all of it: the world
  // doesn't say how customers paid, so it is "external", money that didn't go through Housecall Pro (FIDELITY.md).
  for (const worldInvoice of world.history.invoices) {
    const job = jobs.get(worldInvoice.jobKey)!;
    const paidAt = worldInvoice.paidAt ? hcpTime(worldInvoice.paidAt) : null;
    const payment = paidAt && {
      id: ids.next("pmt"),
      amount: linesTotal(job.line_items),
      payment_method: "external",
      status: "succeeded",
      note: null,
      paid_at: paidAt,
    };
    const invoice: HcpInvoice = {
      id: ids.numbered("invoice", worldInvoice.key),
      invoice_number: job.invoice_number,
      job_id: job.id,
      customer_id: job.customer_id,
      items: job.line_items,
      invoice_date: hcpTime(worldInvoice.issuedAt),
      service_date: job.appointments.at(-1)?.completed_at ?? null,
      sent_at: hcpTime(worldInvoice.issuedAt),
      due_at: hcpTime(worldInvoice.dueAt),
      paid_at: paidAt,
      payments: payment ? [payment] : [],
      created_at: hcpTime(worldInvoice.createdAt),
      updated_at: paidAt ?? hcpTime(worldInvoice.issuedAt),
    };
    events.push({ vendor: "housecallpro", type: "InvoiceCreated", data: { invoice } });
  }
  return events;
}

/** The world's line items, in cents: services as labor, parts as taxable materials (as the books have them). */
function lineItems(lines: WorldLineItem[], world: World, ids: SeedIds): HcpLineItem[] {
  return lines.map((line) => {
    const part = world.catalog.find((entry) => entry.key === line.catalogKey)?.kind === "part";
    return {
      id: ids.next("li"),
      name: line.name,
      description: line.description,
      unit_price: Math.round(line.unitPrice * 100),
      unit_cost: 0, // the documented default: the world doesn't know what the business paid
      quantity: line.quantity,
      kind: part ? "materials" : "labor",
      taxable: part,
    };
  });
}
