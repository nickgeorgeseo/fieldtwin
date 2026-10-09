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

  server.registerTool("twin_reset", { description: "Reset every vendor to the seeded starting world." }, () => asText(ops.resetTwin(twin)));

  server.registerTool(
    "twin_advance_clock",
    { description: "Move twin time forward.", inputSchema: { minutes: z.number().positive() } },
    ({ minutes }) => asText(ops.advanceClock(twin, minutes)),
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

  return server;
}

function asText(value: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(value, null, 2) }] };
}
