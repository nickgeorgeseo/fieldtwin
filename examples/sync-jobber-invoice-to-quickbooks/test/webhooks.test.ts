import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { createApp } from "../../../src/app.ts";
import { advanceClock, loadScenarioByName, runAction, setWebhooks } from "../../../src/control/operations.ts";
import type { JobberState } from "../../../src/vendors/jobber/types.ts";
import type { QboState } from "../../../src/vendors/quickbooks/types.ts";
import { InvoiceQueue } from "../src/invoice-queue.ts";
import { syncPaidInvoice } from "../src/sync.ts";
import { jobberWebhookHandler } from "../src/webhooks.ts";
import { EVER, JOBBER_APP, syncHarness } from "./harness.ts";

const HOOK_URL = "https://app.example.com/webhooks/jobber";

/**
 * The twin delivers its webhooks straight to the example's handler, in process. The handler verifies, queues,
 * and answers; the queue syncs each invoice a webhook names, through the same clients the scheduled sync uses.
 */
async function subscribedSync(scenario?: string) {
  let handle: (request: Request) => Promise<Response> = async () => new Response(null, { status: 503 });
  const target = createApp({ seed: 42, auth: "oauth", sendWebhook: (url, init) => handle(new Request(url, init)) });
  if (scenario) loadScenarioByName(target.twin, scenario);
  const harness = await syncHarness(target);
  const clients = { jobber: harness.jobber, quickbooks: harness.quickbooks, log: harness.runtime.log };
  const queue = new InvoiceQueue((invoiceId) => syncPaidInvoice(clients, invoiceId), harness.runtime.log);
  handle = jobberWebhookHandler({ clientSecret: JOBBER_APP.clientSecret, onEvent: (event) => queue.add(event) });
  setWebhooks(target.twin, [
    { vendor: "jobber", url: HOOK_URL, topics: ["INVOICE_UPDATE"], clientId: JOBBER_APP.clientId, clientSecret: JOBBER_APP.clientSecret },
  ]);

  // Count how often the clients page through every invoice, as opposed to fetching one.
  let pagedEveryInvoice = 0;
  const fetch = harness.runtime.fetch;
  harness.runtime.fetch = async (url, init) => {
    if (String(init?.body).includes("query Invoices(")) pagedEveryInvoice++;
    return fetch(url, init);
  };
  const qbo = () => target.twin.state<QboState>("quickbooks");
  const booked = (number: string) => [...qbo().invoices.values()].filter((invoice) => invoice.DocNumber === number);
  const paidInJobber = () => [...target.twin.state<JobberState>("jobber").invoices.values()].filter((invoice) => invoice.paidAt);
  return { target, harness, queue, booked, paidInJobber, pagedEveryInvoice: () => pagedEveryInvoice, handle: (r: Request) => handle(r) };
}

describe("reacting to Jobber webhooks", () => {
  it("refuses a delivery whose signature doesn't verify, and accepts Jobber's own at once", async () => {
    const { handle } = await subscribedSync();
    const body = JSON.stringify({
      data: { webHookEvent: { topic: "INVOICE_UPDATE", appId: "a", accountId: "b", itemId: "c", occurredAt: "d" } },
    });
    const signedWith = (secret: string) =>
      new Request(HOOK_URL, {
        method: "POST",
        body,
        headers: { "X-Jobber-Hmac-SHA256": createHmac("sha256", secret).update(body).digest("base64") },
      });
    expect((await handle(signedWith("someone-else"))).status).toBe(401);
    expect((await handle(new Request(HOOK_URL, { method: "POST", body }))).status).toBe(401);
    expect((await handle(signedWith(JOBBER_APP.clientSecret))).status).toBe(200);
  });

  it("books invoices paid after the backfill from their webhooks, fetching only those invoices", async () => {
    const { target, harness, queue, booked, paidInJobber, pagedEveryInvoice } = await subscribedSync();
    await harness.sync(EVER); // the backfill
    const before = pagedEveryInvoice();

    await runAction(target.twin, "jobber", "payInvoices", 2); // resolves once the webhooks have been answered
    await queue.idle();
    expect(pagedEveryInvoice()).toBe(before);
    for (const invoice of paidInJobber()) expect(booked(invoice.invoiceNumber)).toEqual([expect.objectContaining({ Balance: 0 })]);
    // Each payment fires INVOICE_UPDATE twice, so an invoice may be synced twice: the second time changes nothing.
    expect(queue.totals).toMatchObject({ invoices: 2, paymentsCreated: 2, failed: 0 });
  });

  it("books each invoice once through flaky APIs and duplicate, late, out-of-order webhooks", async () => {
    const { target, harness, queue, booked, paidInJobber } = await subscribedSync("flaky-apis");
    for (let run = 1; run <= 3 && (await harness.sync(EVER)).failed > 0; run++); // the backfill, run until it settles
    await runAction(target.twin, "jobber", "payInvoices", 3);
    await advanceClock(target.twin, 15); // the late deliveries arrive
    await queue.idle();

    for (const invoice of paidInJobber()) expect(booked(invoice.invoiceNumber)).toEqual([expect.objectContaining({ Balance: 0 })]);
    const payments = [...target.twin.state<QboState>("quickbooks").payments.values()]
      .map((payment) => payment.PaymentRefNum)
      .filter(Boolean);
    expect(new Set(payments).size).toBe(payments.length); // nobody paid twice
    const deliveries = target.twin.webhooks.deliveries();
    expect(deliveries.some((delivery) => delivery.fault === "jobber-webhooks-twice")).toBe(true);
    expect(deliveries.some((delivery) => delivery.fault === "jobber-webhooks-late")).toBe(true);
  });
});
