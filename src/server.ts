import { readFileSync } from "node:fs";
import { serve } from "@hono/node-server";
import { createApp } from "./app.ts";
import { loadScenario, parseAuthMode } from "./control/operations.ts";

const scenarioPath = process.argv.find((arg) => arg.endsWith(".yaml"));

/**
 * Where to listen: the loopback address unless FIELDTWIN_HOST says otherwise (0.0.0.0 in a container). The twin
 * accepts any bearer token by default, its control plane has no auth, and a webhook subscription makes it POST to
 * any URL, so it should only be reachable from the network when someone asks for that.
 */
export function listenOn(env: Record<string, string | undefined>) {
  return { hostname: env.FIELDTWIN_HOST ?? "127.0.0.1", port: Number(env.FIELDTWIN_PORT ?? 4010) };
}

export function startServer() {
  const auth = parseAuthMode(process.env.FIELDTWIN_AUTH ?? "any-token");
  const { app, twin } = createApp({ seed: Number(process.env.FIELDTWIN_SEED ?? 42), auth });
  if (scenarioPath) loadScenario(twin, readFileSync(scenarioPath, "utf8"));

  const { hostname, port } = listenOn(process.env);
  serve({ fetch: app.fetch, hostname, port });
  // stderr, not stdout: when running as an MCP server, stdout belongs to the MCP protocol.
  console.error(`fieldtwin: ${twin.world.company.name} is open for business at http://localhost:${port}`);
  if (hostname !== "127.0.0.1" && hostname !== "localhost") {
    console.error(`fieldtwin: listening on ${hostname}: anyone who can reach this machine can control the twin and send webhooks from it.`);
  }
  console.error(
    twin.authMode === "any-token"
      ? "fieldtwin: auth is any-token: ANY Bearer token is accepted. Set FIELDTWIN_AUTH=oauth for real OAuth checks."
      : "fieldtwin: auth is oauth: only access tokens from the twin's OAuth endpoints are accepted, until they expire.",
  );
  return twin;
}

if (import.meta.url === `file://${process.argv[1]}`) startServer();
