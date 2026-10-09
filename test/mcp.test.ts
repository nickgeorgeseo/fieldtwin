import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { describe, expect, it } from "vitest";
import { createMcpServer } from "../src/control/mcp-tools.ts";
import { setup } from "./helpers.ts";

/** A real MCP client talking to the twin's MCP server in memory: the same protocol a coding agent uses. */
async function connectAgent() {
  const harness = setup();
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  await createMcpServer(harness.twin, "test").connect(serverSide);
  const client = new Client({ name: "test-agent", version: "1.0.0" });
  await client.connect(clientSide);

  const call = async (name: string, args: Record<string, unknown> = {}) => {
    const result = await client.callTool({ name, arguments: args });
    const [content] = result.content as { type: string; text: string }[];
    return JSON.parse(content!.text);
  };
  return { ...harness, client, call };
}

describe("MCP server", () => {
  it("offers the control tools to a coding agent", async () => {
    const { client } = await connectAgent();
    const { tools } = await client.listTools();
    expect(tools.map((tool) => tool.name)).toEqual([
      "twin_status",
      "twin_reset",
      "twin_advance_clock",
      "twin_checkpoint",
      "twin_changes",
      "twin_rewind",
      "twin_list_scenarios",
      "twin_load_scenario",
      "twin_set_faults",
      "twin_set_auth",
      "twin_export_log",
    ]);
  });

  it("lets an agent checkpoint, see what its API calls changed, and rewind them", async () => {
    const { call, qboPost } = await connectAgent();
    await call("twin_checkpoint", { name: "before" });
    await qboPost("/customer", { DisplayName: "Made By The Agent" });

    const changes: string[] = await call("twin_changes", { checkpoint: "before", onlyFromApi: true });
    expect(changes).toHaveLength(1);
    expect(changes[0]).toContain("Made By The Agent");

    await call("twin_rewind", { checkpoint: "before" });
    expect(await call("twin_changes", { checkpoint: "before" })).toEqual([]);
  });
});

describe("MCP server: scenarios, faults, auth, and the log", () => {
  it("lists the ready-made scenarios with what each one is for", async () => {
    const { call } = await connectAgent();
    const scenarios = await call("twin_list_scenarios");
    expect(scenarios.map((scenario: { name: string }) => scenario.name)).toEqual(["flaky-apis", "heat-wave-monday", "mismatched-books"]);
    expect(scenarios[2].description).toContain("drifted");
  });

  it("loads a scenario by name, or from YAML the agent writes", async () => {
    const { call, twin } = await connectAgent();
    expect(await call("twin_load_scenario", { name: "heat-wave-monday" })).toMatchObject({ scenario: "Heat wave Monday" });
    expect(twin.world.customers).toHaveLength(120);

    await call("twin_load_scenario", { yaml: "name: Tiny\nseed: 3\nstartTime: '2026-07-13T11:00:00Z'\nworld: { customers: 5 }\n" });
    expect(twin.world.customers).toHaveLength(5);
  });

  it("refuses scenario names that could reach outside the scenarios folder", async () => {
    const { client } = await connectAgent();
    const result = await client.callTool({ name: "twin_load_scenario", arguments: { name: "../package" } });
    expect(result.isError).toBe(true);
  });

  it("sets fault rules, validated like everywhere else", async () => {
    const { call, client, twin } = await connectAgent();
    await call("twin_set_faults", { rules: [{ name: "down", vendor: "quickbooks", rate: 1, effect: { status: 503 } }] });
    expect(twin.faultRules.map((rule) => rule.name)).toEqual(["down"]);

    const bad = await client.callTool({
      name: "twin_set_faults",
      arguments: { rules: [{ name: "x", vendor: "quickbooks", rate: 9, effect: {} }] },
    });
    expect(bad.isError).toBe(true);
    expect(JSON.stringify(bad.content)).toContain("0.rate");
  });

  it("switches the auth mode", async () => {
    const { call, twin } = await connectAgent();
    expect(await call("twin_set_auth", { mode: "oauth" })).toEqual({ authMode: "oauth" });
    expect(twin.authMode).toBe("oauth");
  });

  it("exports the event log, all of it or since a checkpoint", async () => {
    const { client, call, qboPost, twin } = await connectAgent();
    await call("twin_checkpoint", { name: "before" });
    await qboPost("/customer", { DisplayName: "Logged Customer" });

    const exportLog = async (args: Record<string, unknown>) =>
      ((await client.callTool({ name: "twin_export_log", arguments: args })).content as { text: string }[])[0]!.text;
    expect((await exportLog({})).split("\n")).toHaveLength(twin.log.length);
    const since = (await exportLog({ checkpoint: "before" })).split("\n");
    expect(since).toHaveLength(1);
    expect(JSON.parse(since[0]!)).toMatchObject({ type: "CustomerCreated", source: "api" });
  });
});
