import { readFileSync } from "node:fs";
import type { Server } from "node:http";
import { createAdaptorServer } from "@hono/node-server";
import { type AppOptions, createApp } from "./app.ts";
import { listScenarios, loadScenario, loadScenarioByName } from "./control/operations.ts";
import type { Twin } from "./core/twin.ts";

export interface StartOptions extends Omit<AppOptions, "startTime"> {
  /** The port to listen on. 0, the default, lets the system pick a free one, so every test worker can have its own twin. */
  port?: number;
  /** The address to listen on: the loopback address unless you ask (SECURITY.md says why). */
  hostname?: string;
  /** A ready-made scenario's name, like "flaky-apis", or the path to a scenario YAML file. */
  scenario?: string;
}

export interface RunningTwin {
  /** Where the twin answers, like http://localhost:53122: the base URL for QuickBooks and Jobber, and /housecallpro under it. */
  url: string;
  port: number;
  /** The twin itself, for reading its state in process. The control plane at `${url}/_twin` changes it. */
  twin: Twin;
  /** Stop listening and drop open connections. */
  close(): Promise<void>;
}

/**
 * Start a twin on its own port, from code: a test's beforeAll, or a script that drives an agent. The same twin as
 * `npx fieldtwin`, without printing anything or exiting the process: anything wrong is thrown.
 */
export async function startTwin(options: StartOptions = {}): Promise<RunningTwin> {
  const { port = 0, hostname = "127.0.0.1", scenario, ...appOptions } = options;
  const { app, twin } = createApp(appOptions);
  if (scenario) loadScenarioArgument(twin, scenario);
  const server = createAdaptorServer({ fetch: app.fetch }) as Server;
  await new Promise<void>((resolve, reject) => {
    server.once("error", (error: NodeJS.ErrnoException) =>
      reject(
        error.code === "EADDRINUSE"
          ? new Error(`port ${port} is already in use (is another twin running?). Set FIELDTWIN_PORT to use another one.`)
          : error,
      ),
    );
    server.listen(port, hostname, resolve);
  });
  const address = server.address();
  const actualPort = typeof address === "object" && address ? address.port : port;
  return {
    url: addressOf(hostname, actualPort).url,
    port: actualPort,
    twin,
    close: () =>
      new Promise((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
        server.closeAllConnections();
      }),
  };
}

/**
 * Load a scenario given as a ready-made one's name (`npx fieldtwin flaky-apis`) or a YAML file
 * (`npx fieldtwin my-scenario.yaml`).
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

const LOOPBACK = ["127.0.0.1", "localhost", "::1"];
const EVERY_ADDRESS = ["0.0.0.0", "::"];

/** The URL to print for where the twin listens, and whether other machines can reach it there. */
export function addressOf(hostname: string, port: number): { url: string; reachableByOthers: boolean } {
  const local = LOOPBACK.includes(hostname) || EVERY_ADDRESS.includes(hostname);
  const host = local ? "localhost" : hostname.includes(":") ? `[${hostname}]` : hostname;
  return { url: `http://${host}:${port}`, reachableByOthers: !LOOPBACK.includes(hostname) };
}
