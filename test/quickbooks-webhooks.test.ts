import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { createApp } from "../src/app.ts";
import { setFaults, setWebhooks } from "../src/control/operations.ts";
import { TWIN_REALM_ID } from "../src/vendors/quickbooks/seed.ts";
import { quickbooksWebhooks } from "../src/vendors/quickbooks/webhooks.ts";

/**
 * QuickBooks webhooks: https://developer.intuit.com/app/developer/qbo/docs/develop/webhooks/configure-webhooks
 * and https://developer.intuit.com/app/developer/qbo/docs/develop/webhooks/best-practices
 * The app's endpoint is a function here, so every delivery the twin makes can be inspected.
 */
const VERIFIER = "the-app-verifier-token";
const APP = { vendor: "quickbooks", url: "https://app.example.com/webhooks/quickbooks", clientId: "my-app", clientSecret: VERIFIER };
const COMPANY = `/v3/company/${TWIN_REALM_ID}`;
const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
const SECONDS = 1000;
const MINUTES = 60 * SECONDS;
const HOURS = 60 * MINUTES;

function twinWithEndpoint(answer: (attempt: number) => number = () => 200) {
  const received: { url: string; headers: Headers; body: string }[] = [];
  const { app, twin } = createApp({
    seed: 42,
    sendWebhook: async (url, init) => {
      received.push({ url, headers: new Headers(init.headers), body: String(init.body) });
      return new Response(null, { status: answer(received.length) });
    },
  });
  const request = async (method: string, path: string, body?: unknown) => {
    const headers = { Authorization: "Bearer any", "Content-Type": "application/json" };
    const response = await app.request(`${COMPANY}${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return response.json();
  };
  const subscribe = (topics: string[]) => setWebhooks(twin, [{ ...APP, topics }]);
  const events = () => received.flatMap((delivery) => JSON.parse(delivery.body));
  /** Twin time passes, and whatever falls due on the way is sent. */
  const passTime = async (ms: number) => {
    twin.advance(ms);
    await twin.deliverWebhooks();
  };
  return { app, twin, received, request, subscribe, events, passTime };
}

const line = (Amount: number) => ({ DetailType: "SalesItemLineDetail", Amount, SalesItemLineDetail: { ItemRef: { value: "1" } } });

/** The docs' Java verifier, in Node: the payload's HMAC-SHA256 with the verifier token as the key, base64. */
function isRequestValid(headers: Headers, payload: string, verifier: string): boolean {
  const signature = headers.get("intuit-signature");
  if (signature === null) return false;
  return createHmac("sha256", verifier).update(payload).digest("base64") === signature;
}

describe("QuickBooks webhooks", () => {
  it("deliver qbo.customer.created.v1 when a customer is created, as a CloudEvents array signed with the app's verifier token", async () => {
    const { twin, received, request, subscribe } = twinWithEndpoint();
    subscribe(["qbo.customer.created.v1"]);
    const { Customer } = await request("POST", "/customer", { DisplayName: "Wren Hook" });
    await twin.webhooks.idle();

    expect(received).toHaveLength(1);
    const [delivery] = received;
    expect(delivery!.url).toBe(APP.url);
    expect(delivery!.headers.get("content-type")).toBe("application/json; charset=utf-8");
    expect(isRequestValid(delivery!.headers, delivery!.body, VERIFIER)).toBe(true);
    expect(JSON.parse(delivery!.body)).toEqual([
      {
        specversion: "1.0",
        id: expect.stringMatching(new RegExp(`^${UUID}-Customer-${Customer.Id}$`)),
        source: expect.stringMatching(/^intuit\.[A-Za-z0-9+/]{43}=$/),
        type: "qbo.customer.created.v1",
        datacontenttype: "application/json",
        time: "2026-07-13T11:00:00.000Z", // UTC, as documented
        intuitentityid: Customer.Id,
        intuitaccountid: TWIN_REALM_ID,
        data: {},
      },
    ]);
  });

  it("announce a payment, and each invoice it pays as updated, at the time they happened", async () => {
    const { twin, request, subscribe, events, passTime } = twinWithEndpoint();
    subscribe(["qbo.invoice.created.v1", "qbo.invoice.updated.v1", "qbo.payment.created.v1"]);
    const { Invoice } = await request("POST", "/invoice", { CustomerRef: { value: "3" }, Line: [line(235)] });
    await passTime(5 * MINUTES);
    const payment = {
      CustomerRef: { value: "3" },
      TotalAmt: 235,
      Line: [{ Amount: 235, LinkedTxn: [{ TxnId: Invoice.Id, TxnType: "Invoice" }] }],
    };
    const { Payment } = await request("POST", "/payment", payment);
    await twin.webhooks.idle();

    expect(events().map((event) => [event.type, event.intuitentityid, event.time])).toEqual([
      ["qbo.invoice.created.v1", Invoice.Id, "2026-07-13T11:00:00.000Z"],
      ["qbo.payment.created.v1", Payment.Id, "2026-07-13T11:05:00.000Z"],
      ["qbo.invoice.updated.v1", Invoice.Id, "2026-07-13T11:05:00.000Z"],
    ]);
  });

  it("send only the types a subscription asks for, and nothing for the seeded books", async () => {
    const { app, twin, request, subscribe, received, passTime } = twinWithEndpoint();
    subscribe(["qbo.customer.updated.v1"]);
    await request("POST", "/customer", { DisplayName: "Wren Hook" });
    await app.request("/_twin/reset", { method: "POST" });
    await passTime(0);
    await twin.webhooks.idle();
    expect(received).toEqual([]);
  });

  it("give each event its own id, which every delivery of that event keeps", async () => {
    const { twin, request, subscribe, received, events } = twinWithEndpoint();
    subscribe(["qbo.customer.updated.v1"]);
    setFaults(twin, [{ name: "twice", vendor: "quickbooks", webhook: "qbo.customer.updated.v1", rate: 1, effect: { duplicate: true } }]);
    const { Customer } = await request("GET", "/customer/1");
    const first = await request("POST", "/customer", { Id: "1", SyncToken: Customer.SyncToken, sparse: true, Notes: "First" });
    await request("POST", "/customer", { Id: "1", SyncToken: first.Customer.SyncToken, sparse: true, Notes: "Second" });
    await twin.webhooks.idle();

    const ids = events().map((event) => event.id);
    expect(ids).toHaveLength(4);
    expect(ids[1]).toBe(ids[0]); // the duplicate is the same event again
    expect(ids[3]).toBe(ids[2]);
    expect(ids[2]).not.toBe(ids[0]); // two changes in the same twin second are still two events
    expect(received[1]!.headers.get("X-Twin-Fault")).toBe("twice");
  });

  it("retry a delivery not answered with HTTP 200 at 10s, 20s, 30s, 5m, 20m, 2h, 4h, 6h, then every 6 hours", async () => {
    const { twin, request, subscribe, received, passTime } = twinWithEndpoint(() => 204); // a 2xx, but not the documented 200
    subscribe(["qbo.customer.created.v1"]);
    await request("POST", "/customer", { DisplayName: "Wren Hook" });
    await twin.webhooks.idle();

    const waits = [10 * SECONDS, 20 * SECONDS, 30 * SECONDS, 5 * MINUTES, 20 * MINUTES, 2 * HOURS, 4 * HOURS, 6 * HOURS, 6 * HOURS];
    for (const [attempt, wait] of waits.entries()) {
      await passTime(wait - 1);
      expect(received).toHaveLength(attempt + 1);
      await passTime(1);
      expect(received).toHaveLength(attempt + 2);
    }
    expect(new Set(received.map((delivery) => delivery.body)).size).toBe(1);
  });

  it("give up on a delivery after 20 attempts, about three days of retries", async () => {
    const { app, twin, request, subscribe, received, passTime } = twinWithEndpoint(() => 500);
    subscribe(["qbo.customer.created.v1"]);
    await request("POST", "/customer", { DisplayName: "Wren Hook" });
    await twin.webhooks.idle();
    for (let step = 0; step < 25; step++) await passTime(6 * HOURS);

    expect(received).toHaveLength(20);
    const { deliveries } = await (await app.request("/_twin/webhooks")).json();
    expect(deliveries).toEqual([expect.objectContaining({ attempts: 20, status: "failed", lastAnswer: "HTTP 500" })]);
  });

  it("give an app 3 seconds to answer, and count only HTTP 200 as an answer", () => {
    const { delivery } = quickbooksWebhooks;
    expect(delivery.answerWithinMs).toBe(3 * SECONDS);
    expect([200, 202, 204].map((status) => delivery.accepts(status))).toEqual([true, false, false]);
  });

  it("refuse a type the twin can't send, naming the ones it can", async () => {
    const { app } = twinWithEndpoint();
    const response = await app.request("/_twin/webhooks", {
      method: "PUT",
      body: JSON.stringify([{ ...APP, topics: ["qbo.item.created.v1"] }]),
    });
    expect(response.status).toBe(400);
    expect((await response.json()).error).toMatch(/qbo\.item\.created\.v1.*qbo\.customer\.created\.v1, qbo\.customer\.updated\.v1/);
  });
});
