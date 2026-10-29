import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createMcpServer } from "./control/mcp-tools.ts";
import { isEntryPoint, startServer } from "./server.ts";
import { VERSION } from "./version.ts";

/**
 * `npx fieldtwin mcp` and `npm run mcp`: start the twin's HTTP server (so your code can call the vendor APIs) and
 * serve the control tools to a coding agent over stdio.
 */
export async function startMcp(args = process.argv.slice(2)) {
  const twin = await startServer(args);
  await createMcpServer(twin, VERSION).connect(new StdioServerTransport());
  // An MCP client ends a stdio session by closing the server's stdin. The HTTP server would keep the process, and its
  // port, alive after that, so exit: https://modelcontextprotocol.io/specification/2025-06-18/basic/lifecycle#stdio
  process.stdin.once("end", () => process.exit(0));
  process.stdin.once("close", () => process.exit(0));
}

if (isEntryPoint(import.meta.url)) await startMcp();
