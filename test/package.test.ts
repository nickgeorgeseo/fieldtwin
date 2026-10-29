import { type ChildProcess, execFileSync, spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const ROOT = join(import.meta.dirname, "..");
const pkg = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8"));

/** The npm package as someone who installs it gets it: built, packed, and run on plain Node. */
describe("the npm package", () => {
  let packed: string[] = [];
  const children: ChildProcess[] = [];

  beforeAll(() => {
    execFileSync(process.execPath, ["--import", "tsx", join(ROOT, "scripts", "build.ts")], { cwd: ROOT, stdio: "pipe" });
    const [report] = JSON.parse(
      execFileSync("npm", ["pack", "--dry-run", "--json", "--ignore-scripts"], {
        cwd: ROOT,
        encoding: "utf8",
        shell: process.platform === "win32", // npm is npm.cmd there, which Node runs only through a shell
      }),
    );
    packed = report.files.map((file: { path: string }) => file.path);
  }, 120_000);
  afterAll(() => {
    for (const child of children) child.kill();
  });

  it("ships the compiled twin, Jobber's GraphQL schema, and the ready-made scenarios", () => {
    const entries = [pkg.bin.fieldtwin, pkg.main, pkg.types, pkg.exports["."].default, pkg.exports["."].types];
    for (const file of [...entries, "dist/vendors/jobber/schema/base.graphql"]) {
      expect(packed).toContain(file.replace(/^\.\//, ""));
    }
    expect(packed).toEqual(
      expect.arrayContaining(["scenarios/flaky-apis.yaml", "scenarios/heat-wave-monday.yaml", "scenarios/mismatched-books.yaml"]),
    );
  });

  it("ships nothing else: no source, tests, examples, or dashboard", () => {
    const unexpected = packed.filter((file) => !/^(dist|scenarios)\//.test(file) && !/^(package\.json|README\.md|LICENSE)$/.test(file));
    expect(unexpected).toEqual([]);
  });

  it('keeps only the type declarations that `import ... from "fieldtwin"` can reach', () => {
    const declarations = packed.filter((file) => file.endsWith(".d.ts"));
    expect(declarations).toContain("dist/start.d.ts");
    expect(declarations.filter((file) => file.startsWith("dist/vendors/"))).toEqual([]);
  });

  it("runs its command on plain Node, without tsx, serving every vendor", async () => {
    expect(readFileSync(join(ROOT, pkg.bin.fieldtwin), "utf8")).toMatch(/^#!\/usr\/bin\/env node\n/);
    const child = spawn(process.execPath, [join(ROOT, pkg.bin.fieldtwin)], {
      env: { ...process.env, FIELDTWIN_PORT: "0", NODE_OPTIONS: "" },
    });
    children.push(child);
    const url = await new Promise<string>((resolve, reject) => {
      let output = "";
      child.stderr.on("data", (chunk) => {
        output += chunk;
        const found = /is open for business at (http:\/\/localhost:\d+)/.exec(output);
        if (found) resolve(found[1]!);
      });
      child.on("exit", () => reject(new Error(`Exited before it was open for business:\n${output}`)));
    });
    const clients = await fetch(`${url}/api/graphql`, {
      method: "POST",
      headers: { Authorization: "Bearer dev", "Content-Type": "application/json", "X-JOBBER-GRAPHQL-VERSION": "2025-04-16" },
      body: JSON.stringify({ query: "{ clients(first: 1) { totalCount } }" }),
    });
    expect((await clients.json()).data.clients.totalCount).toBeGreaterThan(0);
    expect((await fetch(`${url}/housecallpro/jobs?page_size=1`, { headers: { Authorization: "Token dev" } })).status).toBe(200);
  }, 20_000);
});

/** server.json, the package's entry in the official MCP Registry, which publishing it checks against the npm package. */
describe("the MCP Registry entry", () => {
  const server = JSON.parse(readFileSync(join(ROOT, "server.json"), "utf8"));
  const [npm] = server.packages;

  it("names the package and version being released, under the package's mcpName", () => {
    expect(server.name).toBe(pkg.mcpName);
    expect(npm.identifier).toBe(pkg.name);
    expect([server.version, npm.version]).toEqual([pkg.version, pkg.version]);
  });

  it("starts the MCP server, with every setting the twin reads from the environment", () => {
    expect(npm.packageArguments).toEqual([{ type: "positional", value: "mcp" }]);
    const settings = new Set(readFileSync(join(ROOT, "src", "server.ts"), "utf8").match(/FIELDTWIN_[A-Z]+/g));
    expect(npm.environmentVariables.map((variable: { name: string }) => variable.name).sort()).toEqual([...settings].sort());
  });
});
