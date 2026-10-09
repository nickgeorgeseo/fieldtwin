import { describe, expect, it } from "vitest";
import { loadScenario, parseAuthMode } from "../src/control/operations.ts";
import { setup } from "./helpers.ts";

type Harness = ReturnType<typeof setup>;
const putAuth = (harness: Harness, body: unknown) =>
  harness.app.request("/_twin/auth", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });

describe("auth modes", () => {
  it("accepts any bearer token by default, for quick local use", async () => {
    const harness = setup();
    expect(harness.twin.authMode).toBe("any-token");
    expect((await harness.jobberAs("anything-at-all", "{ account { name } }")).status).toBe(200);
    expect((await harness.qboGet("/customer/1")).status).toBe(200);
  });

  it("switches to real token checks over the control plane, and reports the mode", async () => {
    const harness = setup();
    expect(await (await putAuth(harness, { mode: "oauth" })).json()).toEqual({ authMode: "oauth" });
    expect((await (await harness.app.request("/_twin")).json()).authMode).toBe("oauth");
    expect((await harness.jobberAs("anything-at-all", "{ account { name } }")).status).toBe(401);
    expect((await harness.qboGet("/customer/1")).status).toBe(401);

    await putAuth(harness, { mode: "any-token" });
    expect((await harness.qboGet("/customer/1")).status).toBe(200);
  });

  it("explains which modes exist when given one it doesn't know", async () => {
    const response = await putAuth(setup(), { mode: "strict" });
    expect(response.status).toBe(400);
    expect((await response.json()).error).toBe('Unknown auth mode "strict". Use "any-token" or "oauth".');
    expect(() => parseAuthMode(undefined)).toThrow(/any-token/);
  });

  it("lets a scenario turn on OAuth", () => {
    const harness = setup();
    loadScenario(harness.twin, "name: Strict\nseed: 1\nstartTime: '2026-07-13T11:00:00Z'\nauth: oauth\n");
    expect(harness.twin.authMode).toBe("oauth");
  });
});
