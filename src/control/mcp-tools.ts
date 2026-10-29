import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { Twin } from "../core/twin.ts";
import { oneOf, toolText } from "./mcp-tool-text.ts";
import * as ops from "./operations.ts";

/**
 * MCP tools that let a coding agent drive the twin: reset it, move time, take checkpoints,
 * and ask "what did I just change?". The agent still talks to the vendor APIs over HTTP,
 * exactly as production code would. These tools are only for controlling the test world.
 *
 * Like the HTTP control plane, every tool is a thin wrapper around operations.ts.
 * The process that serves them over stdio lives in src/mcp.ts. What each tool says is in mcp-tool-text.ts.
 */
export function createMcpServer(twin: Twin, version: string): McpServer {
  const server = new McpServer({ name: "fieldtwin", version });
  const text = toolText(twin);
  const checkpointName = z.string().describe("A checkpoint's name, as given to twin_checkpoint");

  server.registerTool("twin_status", { ...text.twin_status, annotations: READS }, () => asText(ops.describeTwin(twin)));

  server.registerTool("twin_reset", { ...text.twin_reset, annotations: REPLACES }, () => asText(ops.resetTwin(twin)));

  server.registerTool(
    "twin_advance_clock",
    {
      ...text.twin_advance_clock,
      inputSchema: { minutes: z.number().nonnegative().describe("Minutes of twin time to move forward, up to ten years") },
      annotations: HAPPENS,
    },
    async ({ minutes }) => asText(await ops.advanceClock(twin, minutes)),
  );

  server.registerTool(
    "twin_run_action",
    {
      ...text.twin_run_action,
      inputSchema: {
        vendor: z.string().describe(`The vendor: ${oneOf(twin.vendorNames())}`),
        action: z.string().describe("The action's name, like payInvoices"),
        params: z.unknown().describe("How many, like 2"),
      },
      annotations: HAPPENS,
    },
    async ({ vendor, action, params }) => asText(await ops.runAction(twin, vendor, action, params)),
  );

  server.registerTool(
    "twin_checkpoint",
    { ...text.twin_checkpoint, inputSchema: { name: z.string().describe("Any name, like before-sync") }, annotations: REPLACES },
    ({ name }) => asText(ops.createCheckpoint(twin, name)),
  );

  server.registerTool(
    "twin_changes",
    {
      ...text.twin_changes,
      inputSchema: {
        checkpoint: checkpointName,
        onlyFromApi: z.boolean().optional().describe("True to leave out the seed, the scenario timeline, and control tools"),
      },
      annotations: READS,
    },
    ({ checkpoint, onlyFromApi }) => asText(ops.listChanges(twin, checkpoint, { onlyFromApi }).map((change) => change.summary)),
  );

  server.registerTool(
    "twin_rewind",
    { ...text.twin_rewind, inputSchema: { checkpoint: checkpointName }, annotations: REPLACES },
    ({ checkpoint }) => asText(ops.rewindTo(twin, checkpoint)),
  );

  server.registerTool("twin_list_scenarios", { ...text.twin_list_scenarios, annotations: READS }, () => asText(ops.listScenarios()));

  server.registerTool(
    "twin_load_scenario",
    {
      ...text.twin_load_scenario,
      inputSchema: {
        name: z.string().optional().describe("A ready-made scenario's name, like flaky-apis"),
        yaml: z.string().optional().describe("A whole scenario as YAML, instead of a name"),
      },
      annotations: REPLACES,
    },
    ({ name, yaml }) => {
      if (name !== undefined && yaml !== undefined) {
        throw new Error("Give the name of a ready-made scenario or scenario YAML, not both.");
      }
      if (name !== undefined) return asText(ops.loadScenarioByName(twin, name));
      if (yaml !== undefined) return asText(ops.loadScenario(twin, yaml));
      throw new Error("Give either the name of a ready-made scenario or scenario YAML.");
    },
  );

  server.registerTool(
    "twin_set_faults",
    {
      ...text.twin_set_faults,
      inputSchema: { rules: z.array(z.unknown()).describe("Every rule to keep active, shaped as above; [] turns faults off") },
      annotations: REPLACES,
    },
    ({ rules }) => asText(ops.setFaults(twin, rules)),
  );

  server.registerTool(
    "twin_set_auth",
    { ...text.twin_set_auth, inputSchema: { mode: z.enum(["any-token", "oauth"]).describe("The new auth mode") }, annotations: SETS },
    ({ mode }) => asText(ops.setAuthMode(twin, mode)),
  );

  server.registerTool(
    "twin_set_webhooks",
    {
      ...text.twin_set_webhooks,
      inputSchema: { subscriptions: z.array(z.unknown()).describe("Every subscription to keep, shaped as above; [] removes them all") },
      annotations: REPLACES,
    },
    ({ subscriptions }) => asText(ops.setWebhooks(twin, subscriptions)),
  );

  server.registerTool("twin_webhooks", { ...text.twin_webhooks, annotations: READS }, () => asText(ops.describeWebhooks(twin)));

  server.registerTool(
    "twin_export_log",
    {
      ...text.twin_export_log,
      inputSchema: { checkpoint: checkpointName.optional().describe("Only events after this checkpoint; leave it out for the whole log") },
      annotations: READS,
    },
    ({ checkpoint }) => ({ content: [{ type: "text" as const, text: ops.exportLog(twin, { sinceCheckpoint: checkpoint }).jsonl }] }),
  );

  return server;
}

// What each tool does to the twin (MCP's tool annotations), for clients that ask before running a tool that changes
// things. Only webhook deliveries reach outside it, to the URLs an app subscribed.
const READS = { readOnlyHint: true, openWorldHint: false };
/** Replaces or throws away what's there (records, rules, subscriptions, the checkpoint a name points at); again changes nothing more. */
const REPLACES = { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false };
/** Changes a setting and nothing else. */
const SETS = { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false };
/** Records something new each time, and delivers the webhooks it causes. */
const HAPPENS = { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true };

function asText(value: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(value, null, 2) }] };
}
