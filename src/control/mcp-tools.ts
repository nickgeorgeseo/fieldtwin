import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { Twin } from "../core/twin.ts";
import * as ops from "./operations.ts";

/**
 * MCP tools that let a coding agent drive the twin: reset it, move time, take checkpoints,
 * and ask "what did I just change?". The agent still talks to the vendor APIs over HTTP,
 * exactly as production code would. These tools are only for controlling the test world.
 *
 * Like the HTTP control plane, every tool is a thin wrapper around operations.ts.
 * The process that serves them over stdio lives in src/mcp.ts.
 */
export function createMcpServer(twin: Twin, version: string): McpServer {
  const server = new McpServer({ name: "fieldtwin", version });

  server.registerTool(
    "twin_status",
    {
      description: "Company, seed, scenario, twin time, event count, auth mode, faults, checkpoints, and what is scheduled next.",
      annotations: READS,
    },
    () => asText(ops.describeTwin(twin)),
  );

  server.registerTool(
    "twin_reset",
    {
      description: "Back to the start: the seeded world (the loaded scenario's, if any), with its timeline and faults.",
      annotations: REPLACES,
    },
    () => asText(ops.resetTwin(twin)),
  );

  server.registerTool(
    "twin_advance_clock",
    {
      description: "Move twin time forward, up to ten years. 0 sends the webhook deliveries already due.",
      inputSchema: { minutes: z.number().nonnegative() },
      annotations: HAPPENS,
    },
    async ({ minutes }) => asText(await ops.advanceClock(twin, minutes)),
  );

  server.registerTool(
    "twin_run_action",
    {
      description:
        `Make something happen now, as if someone did it in the vendor's own app: ${actionsByVendor(twin)}. ` +
        "Each takes params: how many. Webhooks for it go out before this answers.",
      inputSchema: { vendor: z.string(), action: z.string(), params: z.unknown() },
      annotations: HAPPENS,
    },
    async ({ vendor, action, params }) => asText(await ops.runAction(twin, vendor, action, params)),
  );

  server.registerTool(
    "twin_checkpoint",
    {
      description: "Name the current moment so you can list changes since it or rewind to it.",
      inputSchema: { name: z.string() },
      annotations: REPLACES,
    },
    ({ name }) => asText(ops.createCheckpoint(twin, name)),
  );

  server.registerTool(
    "twin_changes",
    {
      description: "List what changed since a checkpoint. Set onlyFromApi to see only changes your code caused.",
      inputSchema: { checkpoint: z.string(), onlyFromApi: z.boolean().optional() },
      annotations: READS,
    },
    ({ checkpoint, onlyFromApi }) => asText(ops.listChanges(twin, checkpoint, { onlyFromApi }).map((change) => change.summary)),
  );

  server.registerTool(
    "twin_rewind",
    { description: "Undo everything after a checkpoint.", inputSchema: { checkpoint: z.string() }, annotations: REPLACES },
    ({ checkpoint }) => asText(ops.rewindTo(twin, checkpoint)),
  );

  server.registerTool(
    "twin_list_scenarios",
    { description: "The ready-made scenarios, and what each one tests.", annotations: READS },
    () => asText(ops.listScenarios()),
  );

  server.registerTool(
    "twin_load_scenario",
    {
      description:
        "Rebuild the world from a scenario: a ready-made one by name (see twin_list_scenarios), or your own YAML " +
        "(seed, startTime, world, faults, auth, timeline).",
      inputSchema: { name: z.string().optional(), yaml: z.string().optional() },
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
      description:
        "Replace the active fault rules. Each rule: { name, vendor: quickbooks|jobber|housecallpro, method?, pathIncludes?, pathExcludes?, rate: 0-1, " +
        "effect: { status?: HTTP error status, latencyMs?, message?, lostResponse?: do the work, then answer with status } }. " +
        'A rule with webhook: TOPIC or "*" (and no method, pathIncludes, or pathExcludes) affects webhook deliveries instead: effect { duplicate?: true, delayMs? }. An empty list turns faults off.',
      inputSchema: { rules: z.array(z.unknown()) },
      annotations: REPLACES,
    },
    ({ rules }) => asText(ops.setFaults(twin, rules)),
  );

  server.registerTool(
    "twin_set_auth",
    {
      description:
        'How the vendor APIs treat bearer tokens: "any-token" accepts anything; "oauth" accepts only unexpired tokens from the twin\'s OAuth endpoints.',
      inputSchema: { mode: z.enum(["any-token", "oauth"]) },
      annotations: SETS,
    },
    ({ mode }) => asText(ops.setAuthMode(twin, mode)),
  );

  server.registerTool(
    "twin_set_webhooks",
    {
      description:
        "Replace the webhook subscriptions, as an app would set them up in the vendor's developer settings. Each: " +
        `{ vendor: ${twin.vendorNames().join(" | ")}, url, topics, clientId, clientSecret (signs deliveries: for Jobber the app's OAuth ` +
        `client secret, for QuickBooks its verifier token, for Housecall Pro its signing secret) }. ${topicsByVendor(twin)}.`,
      inputSchema: { subscriptions: z.array(z.unknown()) },
      annotations: REPLACES,
    },
    ({ subscriptions }) => asText(ops.setWebhooks(twin, subscriptions)),
  );

  server.registerTool(
    "twin_webhooks",
    { description: "The webhook subscriptions, and the latest deliveries with how each went.", annotations: READS },
    () => asText(ops.describeWebhooks(twin)),
  );

  server.registerTool(
    "twin_export_log",
    {
      description: "The event log as JSON Lines, one event per line: everything, or only what happened since a checkpoint.",
      inputSchema: { checkpoint: z.string().optional() },
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

// The descriptions name each vendor's actions and topics from the vendors themselves, so a new vendor needs no edit here.

/** "jobber newClients or payInvoices; housecallpro newCustomers, completeJobs, invoiceJobs, or payInvoices (quickbooks has none)" */
function actionsByVendor(twin: Twin): string {
  const actions = twin.vendorNames().map((name) => [name, Object.keys(twin.vendor(name).scenarioActions ?? {})] as const);
  const listed = actions.filter(([, names]) => names.length).map(([name, names]) => `${name} ${oneOf(names)}`);
  const without = actions.filter(([, names]) => !names.length).map(([name]) => name);
  return without.length ? `${listed.join("; ")} (${oneOf(without)} has none)` : listed.join("; ");
}

/** "jobber topics: CLIENT_CREATE, INVOICE_UPDATE. quickbooks topics: qbo.customer.created.v1, ..." */
function topicsByVendor(twin: Twin): string {
  return twin
    .vendorNames()
    .map((name) => `${name} topics: ${twin.vendor(name).webhooks?.topics.join(", ") || "none yet"}`)
    .join(". ");
}

/** "a", "a or b", "a, b, or c" */
function oneOf(names: string[]): string {
  return names.length <= 2 ? names.join(" or ") : `${names.slice(0, -1).join(", ")}, or ${names.at(-1)}`;
}
