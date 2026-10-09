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
