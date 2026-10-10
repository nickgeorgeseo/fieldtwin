import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createMcpServer } from "./control/mcp-tools.ts";
import { startServer } from "./server.ts";

/**
 * Entry point for `npm run mcp`: starts the twin's HTTP server (so your code can call the vendor APIs)
 * and serves the control tools to a coding agent over stdio.
 */
const twin = startServer();
await createMcpServer(twin, "0.2.0").connect(new StdioServerTransport());
