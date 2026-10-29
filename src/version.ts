import { readFileSync } from "node:fs";

/** The package's version, from package.json beside src/ (or dist/, once built): `fieldtwin --version` and the MCP server's. */
export const VERSION: string = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")).version;
