import { readFileSync } from "node:fs";
import type { Server } from "node:http";
import { createAdaptorServer } from "@hono/node-server";
import { type AppOptions, createApp } from "./app.ts";
import { listScenarios, loadScenario, loadScenarioByName, parseAuthMode } from "./control/operations.ts";
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
  const { port = 0, hostname = "127.0.0.1", scenario, seed, auth, ...appOptions } = options;
  // Checked as the command checks FIELDTWIN_SEED and FIELDTWIN_AUTH: a typo shouldn't quietly make another twin.
  if (seed !== undefined && !(Number.isSafeInteger(seed) && seed >= 0)) throw new Error(`seed must be a whole number like 42, not ${seed}`);
  const { app, twin } = createApp({ ...appOptions, seed, auth: auth === undefined ? undefined : parseAuthMode(auth) });
  if (scenario) loadScenarioArgument(twin, scenario);
  // Left as they are, @hono/node-server swaps in its own Request and Response globals, in the caller's process too.
  const server = createAdaptorServer({ fetch: app.fetch, overrideGlobalObjects: false }) as Server;
  await new Promise<void>((resolve, reject) => {
    const refuse = (error: NodeJS.ErrnoException) =>
      reject(
        error.code === "EADDRINUSE"
          ? Object.assign(new Error(`port ${port} is already in use (is another twin running?). Pass another port, or 0 for a free one.`), {
              code: "EADDRINUSE",
            })
          : error,
      );
    server.once("error", refuse);
    server.listen(port, hostname, () => {
      server.off("error", refuse); // a later error is the process's to handle, not this promise's
      resolve();
    });
  });
  const address = server.address();
  const actualPort = typeof address === "object" && address ? address.port : port;
  let closing: Promise<void> | undefined; // the first close, which later calls wait for: afterEach and afterAll may both close
  return {
    url: addressOf(hostname, actualPort).url,
    port: actualPort,
    twin,
    close: () =>
      (closing ??= new Promise((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
        server.closeAllConnections();
      })),
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
