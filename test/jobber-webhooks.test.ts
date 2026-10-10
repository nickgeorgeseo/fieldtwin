import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { createApp } from "../src/app.ts";
import type { JobberState } from "../src/vendors/jobber/types.ts";

/**
 * Jobber webhooks: https://developer.getjobber.com/docs/using_jobbers_api/setting_up_webhooks/
 * The app's endpoint is a function here, so every delivery the twin makes can be inspected.
 */
const SECRET = "the-app-client-secret";
const APP = { vendor: "jobber", url: "https://app.example.com/webhooks/jobber", clientId: "my-app", clientSecret: SECRET };

function twinWithEndpoint(answer: (attempt: number) => number = () => 200) {
  const received: { url: string; headers: Headers; body: string }[] = [];
  const { app, twin } = createApp({
    seed: 42,
    sendWebhook: async (url, init) => {
      received.push({ url, headers: new Headers(init.headers), body: String(init.body) });
      return new Response(null, { status: answer(received.length) });
    },
  });
  // A string body (scenario YAML) is sent as it is; anything else as JSON.
  const control = async (method: string, path: string, body?: unknown) => {
    const response = await app.request(path, {
      method,
      headers: { "Content-Type": typeof body === "string" ? "application/yaml" : "application/json" },
      body: body === undefined || typeof body === "string" ? body : JSON.stringify(body),
    });
    if (!response.ok) throw new Error(`${method} ${path} answered ${response.status}: ${await response.text()}`);
    return response;
  };
  const subscribe = async (topics: string[]) => (await control("PUT", "/_twin/webhooks", [{ ...APP, topics }])).json();
  const events = () => received.map((delivery) => JSON.parse(delivery.body).data.webHookEvent);
  return { app, twin, received, control, subscribe, events };
}

const createClient = (app: ReturnType<typeof createApp>["app"]) =>
  app.request("/api/graphql", {
    method: "POST",
    headers: { Authorization: "Bearer any", "Content-Type": "application/json", "X-JOBBER-GRAPHQL-VERSION": "2025-04-16" },
    body: JSON.stringify({
      query: `mutation { clientCreate(input: { firstName: "Wren", lastName: "Hook" }) { client { id } userErrors { message } } }`,
    }),
  });

/** The docs' Node.js verifier, as written: HMAC-SHA256 of the raw body with the app's client secret, base64. */
function verifyWebhook(data: string, hmacHeader: string): boolean {
  return createHmac("sha256", SECRET).update(data).digest("base64") === hmacHeader;
}

describe("Jobber webhooks", () => {
  it("deliver CLIENT_CREATE when a client is created, in the documented payload, signed with the app's client secret", async () => {
    const { app, twin, received, subscribe } = twinWithEndpoint();
    await subscribe(["CLIENT_CREATE"]);
    const created = (await (await createClient(app)).json()).data.clientCreate.client;
    await twin.webhooks.idle();

    expect(received).toHaveLength(1);
    const [delivery] = received;
    expect(delivery!.url).toBe(APP.url);
    expect(delivery!.headers.get("Content-Type")).toBe("application/json");
    expect(verifyWebhook(delivery!.body, delivery!.headers.get("X-Jobber-Hmac-SHA256")!)).toBe(true);
    expect(JSON.parse(delivery!.body)).toEqual({
      data: {
        webHookEvent: {
          topic: "CLIENT_CREATE",
          appId: expect.stringMatching(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/),
          accountId: twin.state<JobberState>("jobber").account.id,
          itemId: created.id,
          occurredAt: "2026-07-13T06:00:00-05:00", // the business's local time, with its offset, like the docs' sample
        },
      },
    });
  });

  it("fire INVOICE_UPDATE twice when an invoice is paid, about a second apart, as the docs describe", async () => {
    const { twin, control, subscribe, events } = twinWithEndpoint();
    await subscribe(["INVOICE_UPDATE"]);
    await control("POST", "/_twin/actions/jobber/payInvoices", 1);

    const [applied, statusChanged] = events();
    expect(events()).toHaveLength(2);
    expect(statusChanged!.itemId).toBe(applied!.itemId);
    expect(Date.parse(statusChanged!.occurredAt) - Date.parse(applied!.occurredAt)).toBe(1000);
    expect(twin.state<JobberState>("jobber").invoices.get(applied!.itemId)!.paidAt).toBeTruthy();
  });

  it("send only the topics a subscription asks for", async () => {
    const { app, twin, control, subscribe, received } = twinWithEndpoint();
    await subscribe(["INVOICE_UPDATE"]);
    await createClient(app);
    await control("POST", "/_twin/actions/jobber/newClients", 2);
    await twin.webhooks.idle();
    expect(received).toEqual([]);
  });

  it("send nothing for the seeded world, or for what a reset or a scenario load rebuilds", async () => {
    const { control, subscribe, received } = twinWithEndpoint();
    await subscribe(["CLIENT_CREATE", "INVOICE_UPDATE"]);
    await control("POST", "/_twin/reset");
    // An entry before the start time runs at load, as history: nobody is told about it now.
    const scenario =
      'name: Earlier\nseed: 42\nstartTime: "2026-07-13T11:00:00Z"\ntimeline:\n  - at: "2026-07-13T10:00:00Z"\n    jobber: { newClients: 2 }\n';
    await control("POST", "/_twin/scenario", scenario);
    await control("POST", "/_twin/clock/advance", { minutes: 0 }); // a delivery round, to send anything queued
    expect(received).toEqual([]);
  });

  it("happen as twin time reaches a scenario's events", async () => {
    const { control, subscribe, events } = twinWithEndpoint();
    const scenario = 'name: Calls\nseed: 42\nstartTime: "2026-07-13T11:00:00Z"\ntimeline:\n  - at: "+1h"\n    jobber: { newClients: 2 }\n';
    await control("POST", "/_twin/scenario", scenario);
    await subscribe(["CLIENT_CREATE"]);
    await control("POST", "/_twin/clock/advance", { minutes: 90 });
    expect(events().map((event) => [event.topic, event.occurredAt])).toEqual([
      ["CLIENT_CREATE", "2026-07-13T07:00:00-05:00"],
      ["CLIENT_CREATE", "2026-07-13T07:00:00-05:00"],
    ]);
  });

  it("retry a delivery the app doesn't accept, a minute of twin time later, with the same payload", async () => {
    const { app, twin, control, subscribe, received } = twinWithEndpoint((attempt) => (attempt === 1 ? 500 : 200));
    await subscribe(["CLIENT_CREATE"]);
    await createClient(app);
    await twin.webhooks.idle();
    expect(received).toHaveLength(1);

    await control("POST", "/_twin/clock/advance", { minutes: 1 });
    expect(received).toHaveLength(2);
    expect(received[1]!.body).toBe(received[0]!.body);
    const { deliveries } = await (await control("GET", "/_twin/webhooks")).json();
    expect(deliveries).toEqual([
      expect.objectContaining({ topic: "CLIENT_CREATE", attempts: 2, status: "delivered", lastAnswer: "HTTP 200" }),
    ]);
  });

  it("keep subscriptions through a reset, like an app's settings, and never show the client secret", async () => {
    const { control, subscribe } = twinWithEndpoint();
    const answer = await subscribe(["CLIENT_CREATE"]);
    await control("POST", "/_twin/reset");
    const { subscriptions } = await (await control("GET", "/_twin/webhooks")).json();
    expect(subscriptions).toEqual(answer.subscriptions);
    expect(JSON.stringify(subscriptions)).not.toContain(SECRET);
  });

  it("refuse a topic the twin can't send, naming the ones it can", async () => {
    const { app } = twinWithEndpoint();
    const response = await app.request("/_twin/webhooks", { method: "PUT", body: JSON.stringify([{ ...APP, topics: ["JOB_CREATE"] }]) });
    expect(response.status).toBe(400);
    expect((await response.json()).error).toMatch(/JOB_CREATE.*CLIENT_CREATE, INVOICE_UPDATE/);
  });
});
