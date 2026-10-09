import { describe, expect, it } from "vitest";
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
