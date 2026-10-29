import { readFileSync } from "node:fs";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createMcpServer } from "./control/mcp-tools.ts";
import { isEntryPoint, startServer } from "./server.ts";

/** The package's version, which the MCP server reports to the agent. */
export const VERSION: string = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")).version;

/**
 * `npx fieldtwin mcp` and `npm run mcp`: start the twin's HTTP server (so your code can call the vendor APIs) and
 * serve the control tools to a coding agent over stdio.
 */
export async function startMcp(args = process.argv.slice(2)) {
  const twin = await startServer(args);
  await createMcpServer(twin, VERSION).connect(new StdioServerTransport());
}

if (isEntryPoint(import.meta.url)) await startMcp();
