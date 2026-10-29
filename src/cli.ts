#!/usr/bin/env node
import { listScenarios } from "./control/operations.ts";
import { startServer } from "./server.ts";
import { VERSION } from "./version.ts";

/**
 * `npx fieldtwin`: the twin, or the twin plus its MCP server, with an optional scenario. Settings stay in the
 * environment (FIELDTWIN_PORT and the rest), as for `npm start`, so a compose file or CI job sets them one way.
 */
const args = process.argv.slice(2);

if (args.includes("--help") || args.includes("-h")) {
  console.log(help());
} else if (args.includes("--version") || args.includes("-v")) {
  console.log(VERSION);
} else {
  const [command, ...rest] = args[0] === "mcp" ? ["mcp", ...args.slice(1)] : ["serve", ...args];
  const option = rest.find((arg) => arg.startsWith("-"));
  if (option) fail(`unknown option "${option}". Settings come from the environment: see fieldtwin --help`);
  if (rest.length > 1) fail(`give one scenario at most, not ${rest.join(" ")}`);
  if (command === "mcp") await (await import("./mcp.ts")).startMcp(rest);
  else await startServer(rest);
}

function fail(message: string): never {
  console.error(`fieldtwin: ${message}`);
  process.exit(1);
}

function help() {
  const scenarios = listScenarios().map(({ name, description }) => `  ${name.padEnd(18)}${/^[^.]*\.?/.exec(description)![0]}`);
  return `fieldtwin ${VERSION}: local twins of the Jobber, Housecall Pro, and QuickBooks Online APIs

Usage:
  fieldtwin [scenario]       start the twin, in a ready-made scenario or a scenario YAML file
  fieldtwin mcp [scenario]   the same, plus an MCP server over stdio for a coding agent

Scenarios:
${scenarios.join("\n")}

Settings (environment variables):
  FIELDTWIN_PORT   the port to listen on (4010; 0 picks a free one)
  FIELDTWIN_HOST   the address to listen on (127.0.0.1)
  FIELDTWIN_AUTH   any-token (any Bearer token works) or oauth (real OAuth checks)
  FIELDTWIN_SEED   which fake business to generate (42)

Docs: https://github.com/nickgeorgeseo/fieldtwin#readme`;
}
