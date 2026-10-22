import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createApp } from "../src/app.ts";
import { controlRoutes } from "../src/control/http.ts";
import { jobberTwin } from "../src/vendors/jobber/index.ts";
import { setup } from "./helpers.ts";

/**
 * The control plane is used by hand, with curl, as often as by code, so a mistake must come back as a 400 that says
 * what to send. Only a bug in the twin is a 500, and it is logged with its stack.
 */

const send = (app: ReturnType<typeof setup>["app"], method: string, path: string, body?: string) =>
  app.request(path, { method, headers: { "Content-Type": "application/json" }, body });
const errorOf = async (response: Response) => ({ status: response.status, error: ((await response.json()) as { error: string }).error });

let logged: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  logged = vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => vi.restoreAllMocks());

describe("control-plane mistakes", () => {
  it.each([
    ["POST", "/_twin/clock/advance", "", '{"minutes": 60}'],
    ["POST", "/_twin/clock/advance", "{oops", '{"minutes": 60}'],
    ["POST", "/_twin/clock/advance", "null", '{"minutes": 60}'],
    ["PUT", "/_twin/auth", "", '{"mode": "oauth"}'],
    ["PUT", "/_twin/faults", "{oops", "fault rules"],
    ["PUT", "/_twin/webhooks", "", "subscriptions"],
    ["POST", "/_twin/actions/jobber/payInvoices", "", "like 2"],
    ["POST", "/_twin/actions/housecallpro/constructor", "1", "has no scenario action"],
    ["POST", "/_twin/actions/jobber/toString", "1", "has no scenario action"],
    ["POST", "/_twin/actions/housecallpro/newCustomers", "4294967296", "1,000"],
    ["POST", "/_twin/checkpoints/nope/rewind", "", 'No checkpoint named "nope"'],
  ])("%s %s with the body %j says what to send", async (method, path, body, says) => {
    const { status, error } = await errorOf(await send(setup().app, method, path, body));
    expect(status).toBe(400);
    expect(error).toContain(says);
    expect(error).not.toMatch(/Cannot read properties|Unexpected end of JSON input$/);
  });

  it("explains an action's parameters without assuming they came from a scenario file", async () => {
    const { error } = await errorOf(await send(setup().app, "POST", "/_twin/actions/jobber/newClients", '{"newClients": 5}'));
    expect(error).toContain("how many");
    expect(error).not.toContain("like { newClients: 5 }");
  });
});

describe("a bug in the twin behind the control plane", () => {
  it("is a 500, logged with its stack, not a 400 blaming the request", async () => {
    const { twin } = createApp();
    const app = controlRoutes(twin);
    twin.checkpoint = () => {
      throw new TypeError("Cannot read properties of undefined (reading 'seq')");
    };
    const response = await app.request("/_twin/checkpoints/before", { method: "POST" });
    expect(response.status).toBe(500);
    expect(String(logged.mock.calls[0]?.[0])).toContain("reading 'seq'");
  });

  it("is a 500 when a scheduled action throws though its check passed, naming the entry and logging where it threw", async () => {
    const { app } = setup();
    await send(
      app,
      "POST",
      "/_twin/scenario",
      'name: Busy\nseed: 42\nstartTime: "2026-07-13T11:00:00Z"\ntimeline:\n  - at: "+1h"\n    jobber: { newClients: 3 }\n',
    );
    vi.spyOn(jobberTwin.scenarioActions!.newClients!, "run").mockImplementation(function runsOutOfNames() {
      throw new Error("out of names");
    });
    const { status, error } = await errorOf(await send(app, "POST", "/_twin/clock/advance", '{"minutes": 120}'));
    expect(status).toBe(500);
    expect(error).toContain("jobber newClients at 2026-07-13T12:00:00.000Z failed: out of names");
    expect(String(logged.mock.calls[0]?.[0])).toContain("runsOutOfNames");
  });
});

describe("what GET /_twin tells you", () => {
  it("names the seed, the loaded scenario, and the checkpoints: what you need to reproduce a run", async () => {
    const { app, twin } = setup();
    await send(app, "POST", "/_twin/scenarios/flaky-apis");
    await send(app, "POST", "/_twin/checkpoints/before-agent");
    const status = await (await app.request("/_twin")).json();
    expect(status).toMatchObject({ seed: 42, scenario: "Flaky APIs", checkpoints: [{ name: "before-agent", time: twin.clock.nowIso() }] });
    expect((await (await send(app, "POST", "/_twin/reset")).json()).checkpoints).toEqual([]);
  });
});

describe("changes since a checkpoint", () => {
  it("can be narrowed to any one source, and says which sources there are when given another", async () => {
    const { app, qboPost } = setup();
    await send(app, "POST", "/_twin/checkpoints/before");
    await qboPost("/customer", { DisplayName: "From The API" });
    await send(app, "POST", "/_twin/actions/jobber/newClients", "1");
    const sources = async (source: string) =>
      ((await (await app.request(`/_twin/checkpoints/before/changes?source=${source}`)).json()) as { source: string }[]).map(
        (c) => c.source,
      );
    expect(await sources("api")).toEqual(["api"]);
    expect(await sources("control")).toEqual(["control"]);
    expect(await errorOf(await app.request("/_twin/checkpoints/before/changes?source=API"))).toEqual({
      status: 400,
      error: 'source must be one of seed, scenario, api, control, not "API"',
    });
  });
});

describe("advancing the clock", () => {
  it("counts only the scenario events it recorded, not a write that came in while webhooks were going out", async () => {
    let answerWebhooks = () => {};
    const webhooksAnswered = new Promise<void>((resolve) => {
      answerWebhooks = resolve;
    });
    const { app } = createApp({
      sendWebhook: async () => {
        await webhooksAnswered;
        return new Response(null, { status: 200 });
      },
    });
    await send(
      app,
      "POST",
      "/_twin/scenario",
      'name: Calls\nseed: 42\nstartTime: "2026-07-13T11:00:00Z"\ntimeline:\n  - at: "+1h"\n    jobber: { newClients: 2 }\n',
    );
    const hook = { vendor: "jobber", url: "http://localhost:1/hooks", topics: ["CLIENT_CREATE"], clientId: "a", clientSecret: "b" };
    await send(app, "PUT", "/_twin/webhooks", JSON.stringify([hook]));

    const advancing = send(app, "POST", "/_twin/clock/advance", '{"minutes": 120}');
    await vi.waitFor(async () => expect((await (await app.request("/_twin")).json()).eventCount).toBeGreaterThan(282));
    await app.request("/v3/company/9341000000000001/customer", {
      method: "POST",
      headers: { Authorization: "Bearer t", "Content-Type": "application/json" },
      body: JSON.stringify({ DisplayName: "Meanwhile" }),
    });
    answerWebhooks();
    expect((await (await advancing).json()).scenarioEvents).toBe(2);
  });
});
