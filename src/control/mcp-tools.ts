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

  server.registerTool("twin_status", { description: "Company, twin time, event count, and active faults." }, () =>
    asText(ops.describeTwin(twin)),
  );

  server.registerTool(
    "twin_reset",
    { description: "Back to the start: the seeded world (the loaded scenario's, if any), with its timeline and faults." },
    () => asText(ops.resetTwin(twin)),
  );

  server.registerTool(
    "twin_advance_clock",
    {
      description: "Move twin time forward, up to ten years. 0 sends the webhook deliveries already due.",
      inputSchema: { minutes: z.number().nonnegative() },
    },
    async ({ minutes }) => asText(await ops.advanceClock(twin, minutes)),
  );

  server.registerTool(
    "twin_run_action",
    {
      description:
        "Make something happen now, as if someone did it in the vendor's own app: jobber payInvoices (params: how many) " +
        "or newClients (params: how many). Webhooks for it go out before this answers.",
      inputSchema: { vendor: z.string(), action: z.string(), params: z.unknown() },
    },
    async ({ vendor, action, params }) => asText(await ops.runAction(twin, vendor, action, params)),
  );

  server.registerTool(
    "twin_checkpoint",
    { description: "Name the current moment so you can list changes since it or rewind to it.", inputSchema: { name: z.string() } },
    ({ name }) => asText(ops.createCheckpoint(twin, name)),
  );

  server.registerTool(
    "twin_changes",
    {
      description: "List what changed since a checkpoint. Set onlyFromApi to see only changes your code caused.",
      inputSchema: { checkpoint: z.string(), onlyFromApi: z.boolean().optional() },
    },
    ({ checkpoint, onlyFromApi }) => asText(ops.listChanges(twin, checkpoint, { onlyFromApi }).map((change) => change.summary)),
  );

  server.registerTool(
    "twin_rewind",
    { description: "Undo everything after a checkpoint.", inputSchema: { checkpoint: z.string() } },
    ({ checkpoint }) => asText(ops.rewindTo(twin, checkpoint)),
  );

  server.registerTool("twin_list_scenarios", { description: "The ready-made scenarios, and what each one tests." }, () =>
    asText(ops.listScenarios()),
  );

  server.registerTool(
    "twin_load_scenario",
    {
      description:
        "Rebuild the world from a scenario: a ready-made one by name (see twin_list_scenarios), or your own YAML " +
        "(seed, startTime, world, faults, auth, timeline).",
      inputSchema: { name: z.string().optional(), yaml: z.string().optional() },
    },
    ({ name, yaml }) => {
      if (name) return asText(ops.loadScenarioByName(twin, name));
      if (yaml) return asText(ops.loadScenario(twin, yaml));
      throw new Error("Give either the name of a ready-made scenario or scenario YAML.");
    },
  );

  server.registerTool(
    "twin_set_faults",
    {
      description:
        "Replace the active fault rules. Each rule: { name, vendor: quickbooks|jobber, method?, pathIncludes?, rate: 0-1, " +
        "effect: { status?: HTTP error status, latencyMs?, message?, lostResponse?: do the work, then answer with status } }. " +
        'A rule with webhook: TOPIC or "*" (and no method or pathIncludes) affects webhook deliveries instead: effect { duplicate?: true, delayMs? }. An empty list turns faults off.',
      inputSchema: { rules: z.array(z.unknown()) },
    },
    ({ rules }) => asText(ops.setFaults(twin, rules)),
  );

  server.registerTool(
    "twin_set_auth",
    {
      description:
        'How the vendor APIs treat bearer tokens: "any-token" accepts anything; "oauth" accepts only unexpired tokens from the twin\'s OAuth endpoints.',
      inputSchema: { mode: z.enum(["any-token", "oauth"]) },
    },
    ({ mode }) => asText(ops.setAuthMode(twin, mode)),
  );

  server.registerTool(
    "twin_set_webhooks",
    {
      description:
        "Replace the webhook subscriptions, as an app would set them up in the vendor's developer settings. Each: " +
        "{ vendor: jobber | quickbooks, url, topics, clientId, clientSecret (signs deliveries) }. Jobber topics: CLIENT_CREATE, " +
        "INVOICE_UPDATE; clientSecret is the app's OAuth client secret. QuickBooks topics: CloudEvents types qbo.customer.created.v1, " +
        "qbo.customer.updated.v1, qbo.invoice.created.v1, qbo.invoice.updated.v1, qbo.payment.created.v1; clientSecret is the verifier token.",
      inputSchema: { subscriptions: z.array(z.unknown()) },
    },
    ({ subscriptions }) => asText(ops.setWebhooks(twin, subscriptions)),
  );

  server.registerTool("twin_webhooks", { description: "The webhook subscriptions, and the latest deliveries with how each went." }, () =>
    asText(ops.describeWebhooks(twin)),
  );

  server.registerTool(
    "twin_export_log",
    {
      description: "The event log as JSON Lines, one event per line: everything, or only what happened since a checkpoint.",
      inputSchema: { checkpoint: z.string().optional() },
    },
    ({ checkpoint }) => ({ content: [{ type: "text" as const, text: ops.exportLog(twin, { sinceCheckpoint: checkpoint }) }] }),
  );

  return server;
}

function asText(value: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(value, null, 2) }] };
}
