import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { createApp } from "../src/app.ts";
import { advanceClock, runAction } from "../src/control/operations.ts";
import type { HcpState } from "../src/vendors/housecallpro/types/index.ts";

/**
 * Housecall Pro webhooks: https://docs.housecallpro.com/docs/housecall-public-api/46e9e1be07621-webhooks
 * The app's endpoint is a function here, so every delivery the twin makes can be inspected.
 */
const SECRET = "the-signing-secret";
const APP = { vendor: "housecallpro", url: "https://app.example.com/webhooks/hcp", clientId: "my-app", clientSecret: SECRET };

function twinWithEndpoint(answer: () => number = () => 200) {
  const received: { url: string; headers: Headers; body: string }[] = [];
  const { app, twin } = createApp({
    seed: 42,
    sendWebhook: async (url, init) => {
      received.push({ url, headers: new Headers(init.headers), body: String(init.body) });
      return new Response(null, { status: answer() });
    },
  });
  const subscribe = async (topics: string[]) => {
    const response = await app.request("/_twin/webhooks", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify([{ ...APP, topics }]),
    });
    if (!response.ok) throw new Error(`subscribing answered ${response.status}: ${await response.text()}`);
  };
  const hcp = (method: string, path: string, body: unknown) =>
    app.request(`/housecallpro${path}`, {
      method,
      headers: { Authorization: "Token key", "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  const payloads = () => received.map((delivery) => JSON.parse(delivery.body));
  return { app, twin, received, subscribe, hcp, payloads };
}

/** The docs' verification steps, as written: HMAC-SHA256 of timestamp + "." + payload, keyed with the signing secret. */
function verify(headers: Headers, body: string): boolean {
  const signatureBody = `${headers.get("Api-Timestamp")}.${body}`;
  return createHmac("sha256", SECRET).update(signatureBody).digest("hex") === headers.get("Api-Signature");
}

describe("Housecall Pro webhooks", () => {
  it("deliver customer.created with the shared fields and the customer, signed as the docs describe", async () => {
    const { twin, received, subscribe, hcp } = twinWithEndpoint();
    await subscribe(["customer.created"]);
    const customer = await (await hcp("POST", "/customers", { first_name: "Wren", last_name: "Hook" })).json();
    await twin.webhooks.idle();

    expect(received).toHaveLength(1);
    const [delivery] = received;
    expect(delivery!.url).toBe(APP.url);
    expect(delivery!.headers.get("Api-Timestamp")).toBe(String(Date.parse("2026-07-13T11:00:00Z") / 1000));
    expect(verify(delivery!.headers, delivery!.body)).toBe(true);
    expect(JSON.parse(delivery!.body)).toEqual({
      event: "customer.created",
      company_id: twin.state<HcpState>("housecallpro").company.id,
      event_occurred_at: "2026-07-13T11:00:00Z",
      event_created_at: "2026-07-13T11:00:00Z",
      customer: expect.objectContaining({ id: customer.id, first_name: "Wren", last_name: "Hook", addresses: [] }),
    });
  });

  it("deliver customer.updated with the customer as the update left it", async () => {
    const { twin, subscribe, hcp, payloads } = twinWithEndpoint();
    await subscribe(["customer.updated"]);
    const customer = await (await hcp("POST", "/customers", { first_name: "Wren" })).json();
    await hcp("PUT", `/customers/${customer.id}`, { last_name: "Hook" });
    await twin.webhooks.idle();
    expect(payloads()).toEqual([
      expect.objectContaining({ event: "customer.updated", customer: expect.objectContaining({ last_name: "Hook" }) }),
    ]);
  });

  it("deliver job.created for a new job, and job.scheduled too when it was created with a schedule", async () => {
    const { twin, subscribe, hcp, payloads } = twinWithEndpoint();
    await subscribe(["job.created", "job.scheduled"]);
    const state = twin.state<HcpState>("housecallpro");
    const customer = [...state.customers.values()][0]!;
    const base = { customer_id: customer.id, address_id: customer.addresses[0]!.id };
    const unscheduled = await (await hcp("POST", "/jobs", base)).json();
    const schedule = { scheduled_start: "2026-07-20T14:00:00Z", scheduled_end: "2026-07-20T16:00:00Z" };
    const scheduled = await (await hcp("POST", "/jobs", { ...base, schedule })).json();
    await twin.webhooks.idle();

    expect(payloads().map((payload) => [payload.event, payload.job.id])).toEqual([
      ["job.created", unscheduled.id],
      ["job.created", scheduled.id],
      ["job.scheduled", scheduled.id],
    ]);
    const job = payloads()[2].job;
    expect(job).toMatchObject({ work_status: "scheduled", schedule: { scheduled_start: schedule.scheduled_start } });
    expect(job.appointments).toEqual([expect.objectContaining({ start_time: schedule.scheduled_start, end_time: schedule.scheduled_end })]);
    expect(job.attachments).toEqual([]); // the Job Webhook Protocol has them, as the API does only when expanded
  });

  it("deliver customer.created for each customer a scenario brings in", async () => {
    const { twin, subscribe, payloads } = twinWithEndpoint();
    await subscribe(["customer.created"]);
    await runAction(twin, "housecallpro", "newCustomers", 2);
    expect(payloads().map((payload) => payload.event)).toEqual(["customer.created", "customer.created"]);
    expect(payloads()[0].customer.addresses).toHaveLength(1);
  });

  it("deliver job.completed with the job as the work left it, once, when a tech finishes it", async () => {
    const { twin, subscribe, payloads } = twinWithEndpoint();
    await subscribe(["job.completed", "job.created", "job.scheduled"]);
    await advanceClock(twin, 9 * 60); // 20:00 on Monday, when seed 42's first two jobs of the day have begun
    await runAction(twin, "housecallpro", "completeJobs", 1);
    await runAction(twin, "housecallpro", "completeJobs", 1);

    expect(payloads().map((payload) => [payload.event, payload.job.invoice_number])).toEqual([
      ["job.completed", "36"],
      ["job.completed", "42"],
    ]);
    expect(payloads()[0]).toMatchObject({
      event_occurred_at: "2026-07-13T20:00:00Z",
      job: {
        work_status: "complete unrated",
        work_timestamps: { completed_at: "2026-07-13T20:00:00Z" },
        appointments: [expect.objectContaining({ start_time: "2026-07-13T13:00:00Z" })],
      },
    });
  });

  it("deliver invoice.payment.succeeded, invoice.paid, and job.paid, in that order, when a customer pays an invoice in full", async () => {
    const { twin, subscribe, payloads } = twinWithEndpoint();
    await subscribe(["invoice.payment.succeeded", "invoice.paid", "job.paid"]);
    await runAction(twin, "housecallpro", "payInvoices", 1);

    const invoice = [...twin.state<HcpState>("housecallpro").invoices.values()].find((each) => each.invoice_number === "23")!;
    expect(payloads().map((payload) => payload.event)).toEqual(["invoice.payment.succeeded", "invoice.paid", "job.paid"]);
    for (const payload of payloads()) expect(payload.event_occurred_at).toBe("2026-07-13T11:00:00Z");
    expect(payloads()[0].invoice).toMatchObject({
      id: invoice.id,
      job_id: invoice.job_id,
      status: "paid",
      due_amount: 0,
      payments: [expect.objectContaining({ status: "succeeded", paid_at: "2026-07-13T11:00:00Z" })],
    });
    expect(payloads()[1].invoice).toEqual(payloads()[0].invoice);
    expect(payloads()[2].job).toMatchObject({ id: invoice.job_id, outstanding_balance: 0 });
  });

  it("send nothing for topics an app didn't subscribe to, or for the seeded world", async () => {
    const { twin, received, subscribe, hcp } = twinWithEndpoint();
    await subscribe(["job.created"]);
    await hcp("POST", "/customers", { first_name: "Wren" });
    twin.reset();
    await twin.webhooks.idle();
    expect(received).toEqual([]);
  });

  it("try a delivery once: the docs promise no retries, so the twin makes none", async () => {
    const { twin, received, subscribe, hcp } = twinWithEndpoint(() => 500);
    await subscribe(["customer.created"]);
    await hcp("POST", "/customers", { first_name: "Wren" });
    await twin.webhooks.idle();
    twin.advance(24 * 3_600_000);
    await twin.deliverWebhooks();
    expect(received).toHaveLength(1);
    expect(twin.webhooks.deliveries()[0]).toMatchObject({ status: "failed", attempts: 1, lastAnswer: "HTTP 500" });
  });

  it("refuse a topic the twin can't send, naming the ones it can", async () => {
    const { app } = twinWithEndpoint();
    const response = await app.request("/_twin/webhooks", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify([{ ...APP, topics: ["lead.created"] }]),
    });
    expect(response.status).toBe(400);
    expect(await response.text()).toMatch(/customer\.created/);
  });
});
