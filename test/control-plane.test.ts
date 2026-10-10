import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createApp } from "../src/app.ts";
import { controlRoutes } from "../src/control/http.ts";
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
afterEach(() => logged.mockRestore());

describe("control-plane mistakes", () => {
  it.each([
    ["POST", "/_twin/clock/advance", "", '{"minutes": 60}'],
    ["POST", "/_twin/clock/advance", "{oops", '{"minutes": 60}'],
    ["POST", "/_twin/clock/advance", "null", '{"minutes": 60}'],
    ["PUT", "/_twin/auth", "", '{"mode": "oauth"}'],
    ["PUT", "/_twin/faults", "{oops", "fault rules"],
    ["PUT", "/_twin/webhooks", "", "subscriptions"],
    ["POST", "/_twin/actions/jobber/payInvoices", "", "like 2"],
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
});
