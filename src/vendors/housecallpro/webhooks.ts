import { createHmac } from "node:crypto";
import type { VendorWebhooks, WebhookNotification } from "../../core/webhooks.ts";
import { hcpTime, hcpTimeAt } from "./dates.ts";
import { asHcpEvent } from "./events.ts";
import { customerResponse } from "./routes/customers.ts";
import { invoiceResponse, invoiceStatus } from "./routes/invoice-response.ts";
import { jobResponse, outstandingBalance } from "./routes/job-response.ts";
import { NOTHING_EXPANDED } from "./routes/lists.ts";
import { workTimestamps } from "./routes/work.ts";
import type { HcpState } from "./types/index.ts";

/**
 * Housecall Pro webhooks, as documented: https://docs.housecallpro.com/docs/housecall-public-api/46e9e1be07621-webhooks
 *
 *   - Payload: "All webhook payloads include shared metadata": `event` (the event key, like `job.created`),
 *     `company_id`, and `event_occurred_at`, and since November 13, 2025 `event_created_at` too (the changelog). Then
 *     the whole record the event is about, as the API answers with it: `customer`, `job` with its `appointments`, or
 *     `invoice` with its `job_id`.
 *   - Signature: `Api-Timestamp` is "the timestamp in seconds since the epoch", and `Api-Signature` an HMAC-SHA256,
 *     keyed with the signing secret, of `timestamp + "." + json_payload`. The docs don't say how the hash is written
 *     out; the twin writes hex (FIDELITY.md).
 *   - Delivery: the docs promise no retries and give no deadline, so the twin tries once and waits at most 3 seconds,
 *     the stricter reading: code that needs every event has to cope with one it missed.
 *
 * Only event keys the twin has events for are offered: customers created or updated, jobs created (and scheduled,
 * when created with a schedule), jobs completed, once all their work is done, invoices created (and sent, when sent as
 * they are made), and invoices paid: each payment that succeeds, the invoice once it is paid in full, and its job once
 * nothing is owed on it. The docs don't give an order; the twin sends them in those. The other keys need writes the
 * twin doesn't model yet.
 */
export const housecallproWebhooks: VendorWebhooks<HcpState> = {
  topics: [
    "customer.created",
    "customer.updated",
    "job.created",
    "job.scheduled",
    "job.completed",
    "job.paid",
    "invoice.created",
    "invoice.sent",
    "invoice.payment.succeeded",
    "invoice.paid",
  ],

  delivery: {
    answerWithinMs: 3000,
    accepts: (status) => status >= 200 && status < 300,
    retryAfterMs: () => null,
  },

  notify(event, state): WebhookNotification[] {
    const data = asHcpEvent(event);
    const at = Date.parse(event.at);
    const now = hcpTime(event.at); // as the records write it, to tell what this very event did
    const announce = (topic: string, itemId: string) => ({ topic, itemId, occurredAtMs: at });
    switch (data.type) {
      case "CustomerCreated":
        return [announce("customer.created", data.customer.id)];
      case "CustomerUpdated":
        return [announce("customer.updated", data.customer.id)];
      // "Job created", and "Job scheduled" too if it was made with a schedule.
      case "JobCreated": {
        const created = announce("job.created", data.job.id);
        return data.job.appointments.length ? [created, announce("job.scheduled", data.job.id)] : [created];
      }
      // Completed by this very update: the last of its work was marked done just now.
      case "JobUpdated":
        return workTimestamps(data.job.appointments).completed_at === now ? [announce("job.completed", data.job.id)] : [];
      // "Invoice created", and "Invoice sent to customer" too if it was sent as it was made.
      case "InvoiceCreated": {
        const created = announce("invoice.created", data.invoice.id);
        return data.invoice.sent_at === now ? [created, announce("invoice.sent", data.invoice.id)] : [created];
      }
      // Paid by this very update: each payment made just now, the invoice if they cover it, and then its job if
      // nothing more is owed on it.
      case "InvoiceUpdated": {
        const { invoice } = data;
        const payments = invoice.payments
          .filter((payment) => payment.paid_at === now && payment.status === "succeeded")
          .map(() => announce("invoice.payment.succeeded", invoice.id));
        if (invoice.paid_at !== now || invoiceStatus(invoice) !== "paid") return payments;
        const jobPaid = outstandingBalance(state.jobs.get(invoice.job_id)!, state) === 0;
        return [...payments, announce("invoice.paid", invoice.id), ...(jobPaid ? [announce("job.paid", invoice.job_id)] : [])];
      }
      default:
        return [];
    }
  },

  // Called as the event is recorded, so the record is as the event left it, even if the delivery goes out later.
  request(notification, subscription, state) {
    const at = hcpTimeAt(notification.occurredAtMs);
    const shared = { event: notification.topic, company_id: state.company.id, event_occurred_at: at, event_created_at: at };
    const body = JSON.stringify({ ...shared, ...record(notification, state) });
    const timestamp = String(Math.floor(notification.occurredAtMs / 1000));
    const signature = createHmac("sha256", subscription.clientSecret).update(`${timestamp}.${body}`).digest("hex");
    return { headers: { "Content-Type": "application/json", "Api-Timestamp": timestamp, "Api-Signature": signature }, body };
  },
};

/** The record an event key is about, under its own name, as the docs' protocols show it. */
function record(notification: WebhookNotification, state: HcpState) {
  if (notification.topic.startsWith("customer.")) {
    return { customer: customerResponse(state.customers.get(notification.itemId)!, state.company, NOTHING_EXPANDED) };
  }
  // The Invoice Protocol carries the invoice's job_id, as Get Invoice by UUID does.
  if (notification.topic.startsWith("invoice.")) return { invoice: invoiceResponse(state.invoices.get(notification.itemId)!, true) };
  const job = state.jobs.get(notification.itemId)!;
  // The Job Webhook Protocol has the appointments beside the schedule rather than in it.
  const appointments = job.appointments.map(({ id, start_time, end_time, arrival_window_minutes }) => ({
    id,
    start_time,
    end_time,
    arrival_window: arrival_window_minutes,
  }));
  return { job: { ...jobResponse(job, state, WITH_ATTACHMENTS), appointments } };
}

const WITH_ATTACHMENTS = new Set(["attachments"]); // the Job Webhook Protocol always has them; the API only when expanded
