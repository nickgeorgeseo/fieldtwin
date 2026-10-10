import { readFileSync, realpathSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { serve } from "@hono/node-server";
import { createApp } from "./app.ts";
import { listScenarios, loadScenario, loadScenarioByName, parseAuthMode } from "./control/operations.ts";
import type { Twin } from "./core/twin.ts";

type Env = Record<string, string | undefined>;

/**
 * Where to listen: the loopback address unless FIELDTWIN_HOST says otherwise (0.0.0.0 in a container). The twin
 * accepts any bearer token by default, its control plane has no auth, and a webhook subscription makes it POST to
 * any URL, so it should only be reachable from the network when someone asks for that.
 */
export function listenOn(env: Env) {
  return { hostname: env.FIELDTWIN_HOST ?? "127.0.0.1", port: wholeNumber(env, "FIELDTWIN_PORT", "a port number", 4010) };
}

/** The twin's seed (the same seed builds the same world) and auth mode, from the environment. */
export function settingsFrom(env: Env) {
  return { seed: wholeNumber(env, "FIELDTWIN_SEED", "a whole number", 42), auth: parseAuthMode(env.FIELDTWIN_AUTH ?? "any-token") };
}

function wholeNumber(env: Env, name: string, description: string, fallback: number): number {
  const text = env[name];
  if (text === undefined) return fallback;
  if (!/^\d+$/.test(text)) throw new Error(`${name} must be ${description} like ${fallback}, not "${text}"`);
  return Number(text);
}

/**
 * Load the scenario named on the command line: a ready-made one by name (`npm start -- flaky-apis`) or a YAML
 * file (`npm start -- my-scenario.yaml`).
 */
export function loadScenarioArgument(twin: Twin, argument: string) {
  if (!/\.ya?ml$/i.test(argument)) return loadScenarioByName(twin, argument);
  let yaml: string;
  try {
    yaml = readFileSync(argument, "utf8");
  } catch {
    const names = listScenarios().map((scenario) => scenario.name);
    throw new Error(`Can't read the scenario file "${argument}". Ready-made scenarios: ${names.join(", ")}`);
  }
  return loadScenario(twin, yaml);
}

/**
 * Start the twin's HTTP server, as `npm start` and `npm run mcp` do. Anything wrong with the environment, the
 * scenario, or the port is printed as one line and exits, rather than as a stack trace.
 */
export function startServer(args = process.argv.slice(2), env: Env = process.env): Twin {
  try {
    const { app, twin } = createApp(settingsFrom(env));
    if (args[0]) loadScenarioArgument(twin, args[0]);
    const { hostname, port } = listenOn(env);
    const server = serve({ fetch: app.fetch, hostname, port }, () => announce(twin, hostname, port));
    server.on("error", (error: NodeJS.ErrnoException) =>
      exitWith(
        error.code === "EADDRINUSE"
          ? `port ${port} is already in use (is another twin running?). Set FIELDTWIN_PORT to use another one.`
          : error.message,
      ),
    );
    return twin;
  } catch (error) {
    return exitWith(error instanceof Error ? error.message : String(error));
  }
}

// stderr, not stdout: when running as an MCP server, stdout belongs to the MCP protocol.
function announce(twin: Twin, hostname: string, port: number) {
  console.error(`fieldtwin: ${twin.world.company.name} is open for business at http://localhost:${port}`);
  if (hostname !== "127.0.0.1" && hostname !== "localhost") {
    console.error(`fieldtwin: listening on ${hostname}: anyone who can reach this machine can control the twin and send webhooks from it.`);
  }
  console.error(
    twin.authMode === "any-token"
      ? "fieldtwin: auth is any-token: ANY Bearer token is accepted. Set FIELDTWIN_AUTH=oauth for real OAuth checks."
      : "fieldtwin: auth is oauth: only access tokens from the twin's OAuth endpoints are accepted, until they expire.",
  );
}

function exitWith(message: string): never {
  console.error(`fieldtwin: ${message}`);
  process.exit(1);
}

/**
 * Whether this file is the one node was asked to run. Node resolves symlinks in the module's URL, so compare it with
 * the real path of what was run, as a URL: the path may hold spaces (percent-encoded in a URL) or be a Windows path.
 */
function isEntryPoint(moduleUrl: string, scriptPath = process.argv[1]): boolean {
  if (!scriptPath) return false;
  try {
    return moduleUrl === pathToFileURL(realpathSync(scriptPath)).href;
  } catch {
    return false;
  }
}

if (isEntryPoint(import.meta.url)) startServer();
