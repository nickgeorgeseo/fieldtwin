import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import type { Tool } from "@modelcontextprotocol/sdk/types.js";
import { describe, expect, it } from "vitest";
import { createMcpServer } from "../src/control/mcp-tools.ts";
import { setup } from "./helpers.ts";

/** A twin with an MCP client, a checkpoint, and one change an agent's API call made since it. */
async function connectAgent() {
  const harness = setup();
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  await createMcpServer(harness.twin, "test").connect(serverSide);
  const client = new Client({ name: "test-agent", version: "1.0.0" });
  await client.connect(clientSide);
  await client.callTool({ name: "twin_checkpoint", arguments: { name: "before" } });
  await harness.qboPost("/customer", { DisplayName: "Made By The Agent" });

  const { tools } = await client.listTools();
  /** Everything a tool could change that the other tools can see: status, the log, and webhooks. */
  const snapshot = async () => {
    const text = async (name: string) => JSON.stringify((await client.callTool({ name, arguments: {} })).content);
    return [await text("twin_status"), await text("twin_export_log"), await text("twin_webhooks")];
  };
  return { client, tools, snapshot };
}

/** Arguments that work for each tool once connectAgent has set the twin up. */
const ARGUMENTS: Record<string, Record<string, unknown>> = {
  twin_advance_clock: { minutes: 30 },
  twin_run_action: { vendor: "jobber", action: "payInvoices", params: 1 },
  twin_checkpoint: { name: "again" },
  twin_changes: { checkpoint: "before" },
  twin_rewind: { checkpoint: "before" },
  twin_load_scenario: { name: "heat-wave-monday" },
  twin_set_faults: { rules: [{ name: "down", vendor: "quickbooks", rate: 1, effect: { status: 503 } }] },
  twin_set_auth: { mode: "oauth" },
  twin_set_webhooks: {
    subscriptions: [{ vendor: "jobber", url: "http://127.0.0.1:9/hooks", topics: ["INVOICE_UPDATE"], clientId: "app", clientSecret: "s" }],
  },
  twin_export_log: { checkpoint: "before" },
};

const hinted = (tools: Tool[], hint: "readOnlyHint" | "idempotentHint") =>
  tools.filter((tool) => tool.annotations?.[hint]).map((tool) => tool.name);

describe("MCP tool hints", () => {
  it("tells clients which tools only read, which replace or undo what's there, and which deliver webhooks", async () => {
    const { tools } = await connectAgent();
    const read = { readOnlyHint: true, openWorldHint: false };
    const replace = { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false };
    const happen = { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true };
    expect(Object.fromEntries(tools.map((tool) => [tool.name, tool.annotations]))).toEqual({
      twin_status: read,
      twin_reset: replace,
      twin_advance_clock: happen,
      twin_run_action: happen,
      twin_checkpoint: replace, // a name already taken moves to now
      twin_changes: read,
      twin_rewind: replace,
      twin_list_scenarios: read,
      twin_load_scenario: replace,
      twin_set_faults: replace,
      twin_set_auth: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
      twin_set_webhooks: replace,
      twin_webhooks: read,
      twin_export_log: read,
    });
  });

  it("changes nothing with a tool it marks read-only", async () => {
    const { client, tools, snapshot } = await connectAgent();
    expect(hinted(tools, "readOnlyHint")).toHaveLength(5);
    for (const name of hinted(tools, "readOnlyHint")) {
      const before = await snapshot();
      expect((await client.callTool({ name, arguments: ARGUMENTS[name] ?? {} })).isError, name).toBeFalsy();
      expect(await snapshot(), name).toEqual(before);
    }
  });

  it("leaves the twin as it was after one call when a tool it marks idempotent is called again", async () => {
    const { tools } = await connectAgent();
    const idempotent = hinted(tools, "idempotentHint").filter((name) => !hinted(tools, "readOnlyHint").includes(name));
    expect(idempotent).toHaveLength(7);
    for (const name of idempotent) {
      const { client, snapshot } = await connectAgent();
      const call = async () => expect((await client.callTool({ name, arguments: ARGUMENTS[name] ?? {} })).isError, name).toBeFalsy();
      await call();
      const once = await snapshot();
      await call();
      expect(await snapshot(), name).toEqual(once);
    }
  });
});
