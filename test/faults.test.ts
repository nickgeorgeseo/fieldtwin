import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { loadScenario } from "../src/control/operations.ts";
import type { FaultRule } from "../src/core/types.ts";
import type { WebhookSender, WebhookSubscription } from "../src/core/webhooks.ts";
import type { QboState } from "../src/vendors/quickbooks/types.ts";
import { setup } from "./helpers.ts";

const putFaults = (app: ReturnType<typeof setup>["app"], body: unknown) =>
  app.request("/_twin/faults", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });

describe("fault rules", () => {
  it("can be switched on over the control plane", async () => {
    const { app, twin, qboGet } = setup();
    const response = await putFaults(app, [{ name: "qbo-down", vendor: "quickbooks", rate: 1, effect: { status: 503 } }]);
    expect(await response.json()).toEqual({ activeFaults: ["qbo-down"] });
    expect(twin.faultRules).toHaveLength(1);

    const failed = await qboGet("/customer/1");
    expect(failed.status).toBe(503);
    expect(failed.headers.get("X-Twin-Fault")).toBe("qbo-down");
  });

  it("are validated, with an error that names the exact field that is wrong", async () => {
    const { app, twin } = setup();
    const response = await putFaults(app, [{ name: "not-an-error", vendor: "quickbooks", rate: 1, effect: { status: 200 } }]);
    expect(response.status).toBe(400);
    expect((await response.json()).error).toMatch(/0\.effect\.status: .*HTTP error status/);
    expect(twin.faultRules).toEqual([]); // nothing half-applied
  });

  it("leave alone the paths a rule excludes, such as the OAuth endpoints a vendor serves under its API's prefix", async () => {
    const { app, hcpGet } = setup();
    const rule = { name: "hcp-down", vendor: "housecallpro", pathExcludes: "/oauth/", rate: 1, effect: { status: 503 } };
    expect((await putFaults(app, [rule])).status).toBe(200);

    expect((await hcpGet("/company")).status).toBe(503);
    const authorize = await app.request("/housecallpro/oauth/authorize?response_type=code&client_id=a&redirect_uri=http://localhost/cb");
    expect(authorize.status).toBe(302);
    expect(authorize.headers.get("X-Twin-Fault")).toBeNull();
  });

  it("reject a rate outside 0 to 1 and an unknown vendor", async () => {
    const { app } = setup();
    const badRate = await putFaults(app, [{ name: "x", vendor: "quickbooks", rate: 5, effect: { status: 500 } }]);
    expect((await badRate.json()).error).toContain("0.rate");
    const badVendor = await putFaults(app, [{ name: "x", vendor: "salesforce", rate: 1, effect: { status: 500 } }]);
    expect((await badVendor.json()).error).toContain("0.vendor");
  });
});

describe("layered fault rules", () => {
  it("gives every matching rule its own chance, not just the first one", async () => {
    const { twin, qboGet } = setup();
    twin.faultRules = [
      { name: "never", vendor: "quickbooks", rate: 0, effect: { status: 429 } },
      { name: "always", vendor: "quickbooks", rate: 1, effect: { status: 503 } },
    ];
    const response = await qboGet("/customer/1");
    expect(response.status).toBe(503);
    expect(response.headers.get("X-Twin-Fault")).toBe("always");
  });

  it("answers with the first error that fires, in rule order", async () => {
    const { twin, qboGet } = setup();
    twin.faultRules = [
      { name: "first", vendor: "quickbooks", rate: 1, effect: { status: 429 } },
      { name: "second", vendor: "quickbooks", rate: 1, effect: { status: 503 } },
    ];
    expect((await qboGet("/customer/1")).headers.get("X-Twin-Fault")).toBe("first");
  });

  it("adds latency from a slow-down rule and still applies an error rule after it", async () => {
    const { twin, qboGet } = setup();
    twin.faultRules = [
      { name: "slow", vendor: "quickbooks", rate: 1, effect: { latencyMs: 20 } },
      { name: "down", vendor: "quickbooks", rate: 1, effect: { status: 503 } },
    ];
    const started = performance.now();
    const response = await qboGet("/customer/1");
    expect(performance.now() - started).toBeGreaterThanOrEqual(15);
    expect(response.headers.get("X-Twin-Fault")).toBe("down");
  });
});

describe("lost responses", () => {
  const LOST: FaultRule = { name: "lost", vendor: "quickbooks", method: "POST", rate: 1, effect: { status: 504, lostResponse: true } };
  const ada = { DisplayName: "Ada Lost", PrimaryEmailAddr: { Address: "ada.lost@example.com" } };
  const adas = (twin: ReturnType<typeof setup>["twin"]) =>
    [...twin.state<QboState>("quickbooks").customers.values()].filter((customer) => customer.DisplayName === "Ada Lost");

  it("do the work, then answer with the error, as if the answer was lost on its way back", async () => {
    const { twin, qboPost } = setup();
    twin.faultRules = [LOST];
    const response = await qboPost("/customer", ada);
    expect(response.status).toBe(504);
    expect(response.headers.get("X-Twin-Fault")).toBe("lost");
    expect((await response.json()).Fault.type).toBe("SystemFault");
    expect(adas(twin)).toHaveLength(1); // the write happened
  });

  it("show why a retried write needs a requestid: with one it happens once, without one it happens twice", async () => {
    const { twin, qboPost } = setup();
    twin.faultRules = [LOST];
    await qboPost("/customer?requestid=ada-1", ada);
    twin.faultRules = [];
    const retried = await qboPost("/customer?requestid=ada-1", ada);
    expect(retried.status).toBe(200);
    expect((await retried.json()).Customer.Id).toBe(adas(twin)[0]!.Id);
    expect(adas(twin)).toHaveLength(1);

    twin.faultRules = [LOST];
    await qboPost("/payment", { CustomerRef: { value: adas(twin)[0]!.Id }, TotalAmt: 10 });
    twin.faultRules = [];
    await qboPost("/payment", { CustomerRef: { value: adas(twin)[0]!.Id }, TotalAmt: 10 });
    const credits = [...twin.state<QboState>("quickbooks").payments.values()].filter(
      (payment) => payment.CustomerRef.value === adas(twin)[0]!.Id,
    );
    expect(credits).toHaveLength(2); // the same $10 credit, recorded twice
  });

  it("need a status to answer with", async () => {
    const { app } = setup();
    const response = await putFaults(app, [{ name: "x", vendor: "quickbooks", rate: 1, effect: { lostResponse: true } }]);
    expect(response.status).toBe(400);
    expect((await response.json()).error).toMatch(/0\.effect: .*lostResponse needs a status/);
  });
});

describe("which requests and deliveries a fault rule picks", () => {
  const coinFlip: FaultRule = { name: "coin", vendor: "quickbooks", method: "POST", rate: 0.5, effect: { status: 503 } };
  const twice: FaultRule = { name: "twice", vendor: "quickbooks", webhook: "*", rate: 0.5, effect: { duplicate: true } };
  const subscription: WebhookSubscription = {
    vendor: "quickbooks",
    url: "https://app.example.com/qbo",
    topics: ["qbo.customer.created.v1"],
    clientId: "a",
    clientSecret: "b",
  };

  /** A twin whose webhook deliveries are noted (with the fault that marked them) instead of sent. */
  function recordingTwin() {
    const faults: (string | null)[] = [];
    const sendWebhook: WebhookSender = async (_url, init) => {
      faults.push(new Headers(init.headers).get("X-Twin-Fault"));
      return new Response(null, { status: 200 });
    };
    return { ...setup(42, { sendWebhook }), faults };
  }

  /** Twenty customer creates, and how each was answered. */
  async function createCustomers(twin: ReturnType<typeof setup>["twin"], qboPost: ReturnType<typeof setup>["qboPost"]) {
    const statuses: number[] = [];
    for (let i = 0; i < 20; i++) statuses.push((await qboPost("/customer", { DisplayName: `Coin Flip ${i}` })).status);
    await twin.webhooks.idle();
    return statuses;
  }

  it("picks the same ones again when the same requests are made after a rewind", async () => {
    const { twin, qboPost, faults } = recordingTwin();
    twin.webhooks.subscriptions = [subscription];
    twin.faultRules = [coinFlip, twice];
    twin.checkpoint("before");
    const first = { statuses: await createCustomers(twin, qboPost), faults: faults.splice(0) };
    expect(first.statuses).toContain(503);
    expect(first.faults).toContain("twice");

    twin.rewind("before");
    expect({ statuses: await createCustomers(twin, qboPost), faults: faults.splice(0) }).toEqual(first);
  });

  it("picks the same requests whether or not webhook faults are rolling for a subscription", async () => {
    const plain = recordingTwin();
    plain.twin.faultRules = [coinFlip];
    const subscribed = recordingTwin();
    subscribed.twin.webhooks.subscriptions = [subscription];
    subscribed.twin.faultRules = [coinFlip, twice];

    expect(await createCustomers(subscribed.twin, subscribed.qboPost)).toEqual(await createCustomers(plain.twin, plain.qboPost));
  });
});

describe("the flaky-apis scenario", () => {
  it("turns on real OAuth checks and fails a good share of requests to each vendor", async () => {
    const { twin, qboGet, jobber } = setup();
    loadScenario(twin, readFileSync("scenarios/flaky-apis.yaml", "utf8"));
    expect(twin.authMode).toBe("oauth");

    // Count only injected failures: in oauth mode the test token is rejected anyway when no fault fires.
    let qboFaults = 0;
    let jobberFaults = 0;
    for (let i = 0; i < 100; i++) {
      if ((await qboGet("/customer/1")).headers.get("X-Twin-Fault")) qboFaults++;
      if ((await jobber("{ account { name } }")).headers.get("X-Twin-Fault")) jobberFaults++;
    }
    expect(qboFaults).toBeGreaterThan(25);
    expect(jobberFaults).toBeGreaterThan(10);
  });
});
