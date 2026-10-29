import { type ChildProcess, spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { afterEach, describe, expect, it } from "vitest";

const CLI = join(import.meta.dirname, "..", "src", "cli.ts");
const { version } = JSON.parse(readFileSync(join(import.meta.dirname, "..", "package.json"), "utf8"));

/** `npx fieldtwin ...`, run from source: what it printed to each stream, and how it exited, if it did. */
describe("the fieldtwin command", () => {
  const children: ChildProcess[] = [];
  afterEach(() => {
    for (const child of children.splice(0)) child.kill();
  });

  function run(args: string[], until?: string) {
    const child = spawn(process.execPath, ["--import", "tsx", CLI, ...args], { env: { ...process.env, FIELDTWIN_PORT: "0" } });
    children.push(child);
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    return new Promise<{ stdout: string; stderr: string; code: number | null }>((resolve) => {
      child.stderr.on("data", (chunk) => {
        stderr += chunk;
        if (until && stderr.includes(until)) resolve({ stdout, stderr, code: null });
      });
      child.on("exit", (code) => resolve({ stdout, stderr, code }));
    });
  }

  it("starts the twin and says where, with no arguments", async () => {
    const { stderr } = await run([], "is open for business at");
    const url = /http:\/\/localhost:\d+/.exec(stderr)![0];
    expect((await fetch(`${url}/_twin`)).status).toBe(200);
  }, 20_000);

  it("starts in a ready-made scenario named as its argument", async () => {
    const { stderr } = await run(["mismatched-books"], "is open for business at");
    const url = /http:\/\/localhost:\d+/.exec(stderr)![0];
    expect((await (await fetch(`${url}/_twin`)).json()).scenario).toBe("Mismatched books");
  }, 20_000);

  it("prints its version", async () => {
    expect(await run(["--version"])).toEqual({ stdout: `${version}\n`, stderr: "", code: 0 });
  }, 20_000);

  it("explains itself with --help: the commands, the scenarios, and the settings", async () => {
    const { stdout, code } = await run(["--help"]);
    expect(code).toBe(0);
    for (const text of ["fieldtwin mcp", "flaky-apis", "heat-wave-monday", "mismatched-books", "FIELDTWIN_PORT", "FIELDTWIN_AUTH"]) {
      expect(stdout).toContain(text);
    }
  }, 20_000);

  it("refuses an option it doesn't know and points to --help, instead of reading it as a scenario", async () => {
    const { stderr, code } = await run(["--port", "4011"]);
    expect(code).toBe(1);
    expect(stderr).toContain('fieldtwin: unknown option "--port". Settings come from the environment: see fieldtwin --help');
  }, 20_000);

  it("refuses more than one scenario", async () => {
    const { stderr, code } = await run(["flaky-apis", "mismatched-books"]);
    expect(code).toBe(1);
    expect(stderr).toContain("fieldtwin: give one scenario at most, not flaky-apis mismatched-books");
  }, 20_000);

  it("ends `fieldtwin mcp` when the agent closes its stdin, instead of leaving a twin holding the port", async () => {
    const child = spawn(process.execPath, ["--import", "tsx", CLI, "mcp"], { env: { ...process.env, FIELDTWIN_PORT: "0" } });
    children.push(child);
    let stderr = "";
    await new Promise<void>((resolve) =>
      child.stderr.on("data", (chunk) => {
        stderr += chunk;
        if (stderr.includes("is open for business at")) resolve();
      }),
    );
    const url = /http:\/\/localhost:\d+/.exec(stderr)![0];
    const exited = new Promise<number | null>((resolve) => child.on("exit", resolve));
    child.stdin.end();
    expect(await exited).toBe(0);
    await expect(fetch(`${url}/_twin`)).rejects.toThrow();
  }, 20_000);

  it("serves the control tools over stdio with `fieldtwin mcp`, the way a coding agent starts it", async () => {
    const transport = new StdioClientTransport({
      command: process.execPath,
      args: ["--import", "tsx", CLI, "mcp", "flaky-apis"],
      env: { ...(process.env as Record<string, string>), FIELDTWIN_PORT: "0" },
      stderr: "pipe",
    });
    const client = new Client({ name: "test-agent", version: "1.0.0" });
    await client.connect(transport);
    try {
      expect(client.getServerVersion()?.version).toBe(version);
      const result = await client.callTool({ name: "twin_status", arguments: {} });
      const [content] = result.content as { text: string }[];
      expect(JSON.parse(content!.text).scenario).toBe("Flaky APIs");
    } finally {
      await client.close();
    }
  }, 20_000);
});
