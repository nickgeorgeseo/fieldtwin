import { readFileSync } from "node:fs";
import { serve } from "@hono/node-server";
import { createApp } from "./app.ts";
import { loadScenario } from "./control/operations.ts";

const port = Number(process.env.FIELDTWIN_PORT ?? 4010);
const scenarioPath = process.argv.find((arg) => arg.endsWith(".yaml"));

export function startServer() {
  const { app, twin } = createApp({ seed: Number(process.env.FIELDTWIN_SEED ?? 42) });
  if (scenarioPath) loadScenario(twin, readFileSync(scenarioPath, "utf8"));

  serve({ fetch: app.fetch, port });
  // stderr, not stdout: when running as an MCP server, stdout belongs to the MCP protocol.
  console.error(`fieldtwin: ${twin.world.company.name} is open for business at http://localhost:${port}`);
  return twin;
}

if (import.meta.url === `file://${process.argv[1]}`) startServer();
