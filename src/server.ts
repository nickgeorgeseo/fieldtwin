import { readFileSync } from "node:fs";
import { serve } from "@hono/node-server";
import { createApp } from "./app.ts";
import { loadScenario, parseAuthMode } from "./control/operations.ts";

const port = Number(process.env.FIELDTWIN_PORT ?? 4010);
const scenarioPath = process.argv.find((arg) => arg.endsWith(".yaml"));

export function startServer() {
  const auth = parseAuthMode(process.env.FIELDTWIN_AUTH ?? "any-token");
  const { app, twin } = createApp({ seed: Number(process.env.FIELDTWIN_SEED ?? 42), auth });
  if (scenarioPath) loadScenario(twin, readFileSync(scenarioPath, "utf8"));

  serve({ fetch: app.fetch, port });
  // stderr, not stdout: when running as an MCP server, stdout belongs to the MCP protocol.
  console.error(`fieldtwin: ${twin.world.company.name} is open for business at http://localhost:${port}`);
  console.error(
    twin.authMode === "any-token"
      ? "fieldtwin: auth is any-token: ANY Bearer token is accepted. Set FIELDTWIN_AUTH=oauth for real OAuth checks."
      : "fieldtwin: auth is oauth: only access tokens from the twin's OAuth endpoints are accepted, until they expire.",
  );
  return twin;
}

if (import.meta.url === `file://${process.argv[1]}`) startServer();
