import { realpathSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { parseAuthMode } from "./control/operations.ts";
import type { Twin } from "./core/twin.ts";
import { addressOf, type RunningTwin, startTwin } from "./start.ts";

type Env = Record<string, string | undefined>;

/**
 * Where to listen: the loopback address unless FIELDTWIN_HOST says otherwise (0.0.0.0 in a container). The twin
 * accepts any bearer token by default, its control plane has no auth, and a webhook subscription makes it POST to
 * any URL, so it should only be reachable from the network when someone asks for that.
 */
export function listenOn(env: Env) {
  return { hostname: setting(env, "FIELDTWIN_HOST") ?? "127.0.0.1", port: wholeNumber(env, "FIELDTWIN_PORT", "a port number", 4010) };
}

/** The twin's seed (the same seed builds the same world) and auth mode, from the environment. */
export function settingsFrom(env: Env) {
  return {
    seed: wholeNumber(env, "FIELDTWIN_SEED", "a whole number", 42),
    auth: parseAuthMode(setting(env, "FIELDTWIN_AUTH") ?? "any-token"),
  };
}

/** A setting's value, or undefined if it is unset or empty: a compose file passes on a variable nobody set as "". */
function setting(env: Env, name: string): string | undefined {
  return env[name]?.trim() || undefined;
}

function wholeNumber(env: Env, name: string, description: string, fallback: number): number {
  const text = setting(env, name);
  if (text === undefined) return fallback;
  if (!/^\d+$/.test(text)) throw new Error(`${name} must be ${description} like ${fallback}, not "${text}"`);
  return Number(text);
}

/**
 * Start the twin's HTTP server, as `npx fieldtwin` and `npm start` do. Anything wrong with the environment, the
 * scenario, or the port is printed as one line and exits, rather than as a stack trace.
 */
export async function startServer(args = process.argv.slice(2), env: Env = process.env): Promise<Twin> {
  try {
    const { hostname, port } = listenOn(env);
    const running = await startTwin({ ...settingsFrom(env), hostname, port, scenario: args[0] });
    announce(running, hostname); // the port it really got: FIELDTWIN_PORT=0 lets the system pick one
    return running.twin;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EADDRINUSE") {
      return exitWith(`port ${listenOn(env).port} is already in use (is another twin running?). Set FIELDTWIN_PORT to use another one.`);
    }
    return exitWith(error instanceof Error ? error.message : String(error));
  }
}

// stderr, not stdout: when running as an MCP server, stdout belongs to the MCP protocol.
function announce({ twin, url }: RunningTwin, hostname: string) {
  console.error(`fieldtwin: ${twin.world.company.name} is open for business at ${url}`);
  if (addressOf(hostname, 0).reachableByOthers) {
    console.error(`fieldtwin: listening on ${hostname}: anyone who can reach this machine can control the twin and send webhooks from it.`);
  }
  console.error(
    twin.authMode === "any-token"
      ? "fieldtwin: auth is any-token: ANY Bearer token is accepted. Set FIELDTWIN_AUTH=oauth for real OAuth checks."
      : "fieldtwin: auth is oauth: only access tokens from the twin's OAuth endpoints are accepted, until they expire. " +
          "Housecall Pro API keys (Token <key>) work too, as the twin can't check them.",
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
export function isEntryPoint(moduleUrl: string, scriptPath = process.argv[1]): boolean {
  if (!scriptPath) return false;
  try {
    return moduleUrl === pathToFileURL(realpathSync(scriptPath)).href;
  } catch {
    return false;
  }
}

if (isEntryPoint(import.meta.url)) void startServer();
