import { describe, expect, it } from "vitest";
import { createApp } from "../src/app.ts";
import { advanceClock, runAction, setFaults, setWebhooks } from "../src/control/operations.ts";
import type { FaultRule } from "../src/core/types.ts";

/**
 * Webhook delivery faults: what at-least-once delivery does to an app on a bad day. Jobber documents duplicates
 * ("the same webhook may be delivered more than once"); late deliveries are how webhooks arrive out of order.
 */
function subscribedTwin(topics = ["CLIENT_CREATE", "INVOICE_UPDATE"]) {
  const received: { topic: string; fault: string | null }[] = [];
  const { app, twin } = createApp({
    seed: 42,
    sendWebhook: async (_url, init) => {
      received.push({ topic: JSON.parse(init.body).data.webHookEvent.topic, fault: new Headers(init.headers).get("X-Twin-Fault") });
      return new Response(null, { status: 200 });
    },
  });
  setWebhooks(twin, [{ vendor: "jobber", url: "https://app.example.com/hooks", topics, clientId: "app", clientSecret: "s" }]);
  return { app, twin, received };
}

describe("webhook delivery faults", () => {
  it("can deliver a webhook twice, marking the copy", async () => {
    const { twin, received } = subscribedTwin();
    setFaults(twin, [{ name: "twice", vendor: "jobber", webhook: "INVOICE_UPDATE", rate: 1, effect: { duplicate: true } }]);
    await runAction(twin, "jobber", "payInvoices", 1);
    expect(received).toEqual([
      { topic: "INVOICE_UPDATE", fault: null },
      { topic: "INVOICE_UPDATE", fault: "twice" },
      { topic: "INVOICE_UPDATE", fault: null },
      { topic: "INVOICE_UPDATE", fault: "twice" },
    ]);
  });

  it("can deliver a webhook late, so later ones overtake it", async () => {
    const { twin, received } = subscribedTwin();
    setFaults(twin, [{ name: "late", vendor: "jobber", webhook: "CLIENT_CREATE", rate: 1, effect: { delayMs: 600_000 } }]);
    await runAction(twin, "jobber", "newClients", 1);
    await runAction(twin, "jobber", "payInvoices", 1);
    expect(received.map((delivery) => delivery.topic)).toEqual(["INVOICE_UPDATE", "INVOICE_UPDATE"]);

    await advanceClock(twin, 10);
    expect(received.at(-1)).toEqual({ topic: "CLIENT_CREATE", fault: "late" });
  });

  it("leave API requests alone", async () => {
    const { app, twin } = subscribedTwin();
    setFaults(twin, [{ name: "twice", vendor: "jobber", webhook: "*", rate: 1, effect: { duplicate: true } }]);
    const response = await app.request("/api/graphql", {
      method: "POST",
      headers: { Authorization: "Bearer any", "Content-Type": "application/json", "X-JOBBER-GRAPHQL-VERSION": "2025-04-16" },
      body: JSON.stringify({ query: "{ account { name } }" }),
    });
    expect(response.headers.get("X-Twin-Fault")).toBeNull();
  });

  it("take only the effects a delivery can have, and request rules don't take them", () => {
    const { twin } = subscribedTwin();
    const rule = (fields: Partial<FaultRule>) => ({ name: "x", vendor: "jobber", rate: 1, ...fields });
    expect(() => setFaults(twin, [rule({ webhook: "*", effect: { status: 500 } })])).toThrow(
      /0: .*webhook rules take duplicate or delayMs/,
    );
    expect(() => setFaults(twin, [rule({ webhook: "*", method: "POST", effect: { duplicate: true } })])).toThrow(
      /match deliveries, not requests/,
    );
    expect(() => setFaults(twin, [rule({ effect: { duplicate: true } })])).toThrow(/duplicate and delayMs are for webhook rules/);
  });
});
