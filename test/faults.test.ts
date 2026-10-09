import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { loadScenario } from "../src/control/operations.ts";
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
