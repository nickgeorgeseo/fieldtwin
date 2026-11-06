import { afterAll, beforeEach, describe, expect, expectTypeOf, it } from "vitest";
import { createApp } from "../src/app.ts";
import { connectTwin, TwinError } from "../src/client.ts";
import type { EventOf, Scenario, TwinStatus, VendorInfo, WebhookReport } from "../src/client-types.ts";
import type * as ops from "../src/control/operations.ts";
import { startTwin } from "../src/start.ts";
import { TWIN_REALM_ID } from "../src/vendors/quickbooks/seed.ts";

/** The control-plane client startTwin() returns, driven against a twin on a real port, the way a test file in a user's project would. */
describe("the twin's client", async () => {
  const twin = await startTwin();
  afterAll(() => twin.close());
  beforeEach(async () => {
    await twin.loadScenario({ name: "client test", seed: 42, startTime: "2026-07-13T11:00:00Z" });
    await twin.setAuth("any-token");
  });

  it("reads the twin's status", async () => {
    const status = await twin.status();
    expect(status.seed).toBe(42);
    expect(status.vendors).toEqual(["quickbooks", "jobber", "housecallpro"]);
  });

  it("lists what your code changed since a checkpoint, narrowed by vendor and type, with each record typed", async () => {
    await twin.checkpoint("before");
    const created = await fetch(`${twin.url}/v3/company/${TWIN_REALM_ID}/customer`, {
      method: "POST",
      headers: { Authorization: "Bearer dev", "Content-Type": "application/json" },
      body: JSON.stringify({ DisplayName: "Dana Whitfield" }),
    });
    expect(created.status).toBe(200);
    await twin.runAction("jobber", "newClients", 1);

    const customers = await twin.changes("before", { source: "api", vendor: "quickbooks", type: "CustomerCreated" });
    expectTypeOf(customers[0]!.data.customer.DisplayName).toEqualTypeOf<string>();
    expect(customers.map((change) => change.data.customer.DisplayName)).toEqual(["Dana Whitfield"]);
    expect(customers[0]!.summary).toContain('CustomerCreated Id=26 "Dana Whitfield"');
    expect((await twin.changes("before")).map((change) => change.source)).toEqual(["api", "control"]);
  });

  it("rewinds to a checkpoint and loads ready-made scenarios by name", async () => {
    await twin.checkpoint("start");
    await twin.advance({ hours: 2 });
    expect((await twin.rewind("start")).twinTime).toBe("2026-07-13T11:00:00.000Z");
    expect((await twin.loadScenario("flaky-apis")).scenario).toBe("Flaky APIs");
    expect((await twin.scenarios()).map((scenario) => scenario.name)).toContain("flaky-apis");
  });

  it("loads a scenario written as YAML or as a typed object, with its faults", async () => {
    const scenario: Scenario = {
      name: "slow jobber",
      seed: 7,
      startTime: "2026-07-13T11:00:00Z",
      faults: [{ name: "slow", vendor: "jobber", rate: 1, effect: { latencyMs: 1 } }],
    };
    expect(await twin.loadScenario(scenario)).toMatchObject({ seed: 7, scenario: "slow jobber", activeFaults: ["slow"] });
    expect(await twin.loadScenario('name: from yaml\nseed: 9\nstartTime: "2026-07-13T11:00:00Z"\n')).toMatchObject({ seed: 9 });
  });

  it("moves twin time by minutes, hours, and days together", async () => {
    const { twinTime } = await twin.advance({ days: 1, hours: 2, minutes: 30 });
    expect(twinTime).toBe("2026-07-14T13:30:00.000Z");
  });

  it("throws the twin's own reason when it refuses, with the HTTP status", async () => {
    const refusal = await twin.rewind("never-taken").catch((error: unknown) => error);
    expect(refusal).toBeInstanceOf(TwinError);
    expect(refusal).toMatchObject({ status: 400, message: expect.stringContaining("never-taken") });
  });

  it("refuses a checkpoint named . or .., which a URL can't carry, rather than reaching another route", async () => {
    for (const name of [".", ".."]) {
      for (const call of [() => twin.checkpoint(name), () => twin.changes(name), () => twin.rewind(name)]) {
        await expect(call()).rejects.toMatchObject({ name: "TwinError", status: 400, message: expect.stringContaining(`"${name}"`) });
      }
    }
    expect((await twin.status()).checkpoints).toEqual([]);
  });

  it("follows the log from a position, and says when its history is gone", async () => {
    const all = await twin.log();
    expect(all.events.length).toBeGreaterThan(100);
    await twin.runAction("jobber", "payInvoices", 1);
    const since = await twin.log({ after: all.position });
    expect(since.events.map((event) => event.type)).toEqual(["InvoiceUpdated"]);
    await twin.reset();
    await expect(twin.log({ after: since.position })).rejects.toMatchObject({ status: 409 });
  });

  it("names each vendor's actions and webhook topics, so callers needn't hard-code them", async () => {
    const vendors = await twin.vendors();
    expect(vendors.find((vendor) => vendor.name === "housecallpro")).toMatchObject({
      pathPrefix: "/housecallpro",
      actions: ["newCustomers", "completeJobs", "invoiceJobs", "payInvoices"],
    });
    expect(vendors.find((vendor) => vendor.name === "jobber")?.webhookTopics).toContain("INVOICE_UPDATE");
  });

  it("sets faults and webhook subscriptions, and reads the subscriptions back without their secrets", async () => {
    expect(await twin.setFaults([{ name: "slow", vendor: "quickbooks", rate: 1, effect: { latencyMs: 1 } }])).toEqual({
      activeFaults: ["slow"],
    });
    const report = await twin.setWebhooks([
      { vendor: "jobber", url: "http://localhost:1/hooks", topics: ["INVOICE_UPDATE"], clientId: "app", clientSecret: "secret" },
    ]);
    expect(report.subscriptions).toEqual([
      { vendor: "jobber", url: "http://localhost:1/hooks", topics: ["INVOICE_UPDATE"], clientId: "app" },
    ]);
    expect(await twin.webhooks()).toEqual(report);
    await twin.setWebhooks([]);
    await twin.setFaults([]);
  });

  it("connects an app to each vendor through its OAuth server, for tokens that work in oauth mode", async () => {
    await twin.setAuth("oauth");
    const quickbooks = await twin.connect("quickbooks");
    expect(quickbooks.realmId).toBe(TWIN_REALM_ID);
    const read = (path: string, token: string, scheme = "Bearer") =>
      fetch(`${twin.url}${path}`, { headers: { Authorization: `${scheme} ${token}` } });
    expect((await read(`/v3/company/${TWIN_REALM_ID}/customer/1`, quickbooks.accessToken)).status).toBe(200);
    expect((await read(`/v3/company/${TWIN_REALM_ID}/customer/1`, "made-up")).status).toBe(401);

    const jobber = await twin.connect("jobber", { clientId: "my-app" });
    const query = await fetch(`${twin.url}/api/graphql`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${jobber.accessToken}`,
        "Content-Type": "application/json",
        "X-JOBBER-GRAPHQL-VERSION": "2025-04-16",
      },
      body: JSON.stringify({ query: "{ clients(first: 1) { totalCount } }" }),
    });
    expect((await query.json()).data.clients.totalCount).toBeGreaterThan(0);

    const housecallpro = await twin.connect("housecallpro");
    expect(housecallpro.expiresIn).toBe(2_592_000);
    expect((await read("/housecallpro/company", housecallpro.accessToken)).status).toBe(200);
  });

  it("retries connecting when a fault rule fails the OAuth endpoints, since that failure was injected", async () => {
    await twin.setAuth("oauth");
    await twin.setFaults([{ name: "token-flaky", vendor: "jobber", pathIncludes: "/oauth/token", rate: 0.5, effect: { status: 503 } }]);
    expect((await twin.connect("jobber")).accessToken).toMatch(/^eyJ/);
  });
});

describe("connectTwin()", () => {
  it("drives an in-process twin through a fetch you pass, with no port at all", async () => {
    const { app } = createApp({ seed: 3 });
    const twin = connectTwin("http://twin.test/", { fetch: (url, init) => app.request(url, init) });
    expect(twin.url).toBe("http://twin.test");
    expect((await twin.status()).seed).toBe(3);
  });

  it("says what answered when the address isn't a twin's control plane", async () => {
    const twin = connectTwin("http://not.a.twin", { fetch: () => new Response("Not Found", { status: 404 }) });
    await expect(twin.status()).rejects.toThrow("GET /_twin answered HTTP 404: Not Found");
  });
});

describe("the client's types", () => {
  it("describe what the control plane really answers", () => {
    expectTypeOf<ReturnType<typeof ops.describeTwin>>().toExtend<TwinStatus>();
    expectTypeOf<ReturnType<typeof ops.describeVendors>[number]>().toExtend<VendorInfo>();
    expectTypeOf<ReturnType<typeof ops.describeWebhooks>>().toExtend<WebhookReport>();
  });

  it("narrow an event's data by vendor and type", () => {
    expectTypeOf<EventOf<"housecallpro", "JobCreated">["data"]["job"]["invoice_number"]>().not.toBeAny();
    expectTypeOf<EventOf<"jobber", "ClientCreated">["vendor"]>().toEqualTypeOf<"jobber">();
  });
});
