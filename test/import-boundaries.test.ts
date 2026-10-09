import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { findImports, isAllowedImport, listTypeScriptFiles, projectImports } from "./architecture-rules.ts";

const SRC = join(import.meta.dirname, "..", "src");
const EXAMPLES = join(import.meta.dirname, "..", "examples");

describe("import boundaries (ARCHITECTURE.md, 'Layers and who may import whom')", () => {
  it("knows the rules", () => {
    expect(isAllowedImport("vendors/jobber/routes.ts", "core/twin.ts")).toBe(true);
    expect(isAllowedImport("vendors/jobber/routes.ts", "vendors/quickbooks/errors.ts")).toBe(false);
    expect(isAllowedImport("faults/fault-middleware.ts", "vendors/jobber/index.ts")).toBe(false);
    expect(isAllowedImport("control/operations.ts", "app.ts")).toBe(false);
    expect(isAllowedImport("world/generate-world.ts", "core/random.ts")).toBe(true);
    expect(isAllowedImport("world/generate-world.ts", "core/twin.ts")).toBe(false);
    expect(isAllowedImport("app.ts", "vendors/jobber/index.ts")).toBe(true);
  });

  it("reads static imports, re-exports, and dynamic imports", () => {
    const source = 'import a from "./a.ts";\nexport { b } from "../b.ts";\nconst c = await import("./c.ts");';
    expect(findImports(source)).toEqual(["./a.ts", "../b.ts", "./c.ts"]);
  });

  it("holds for every file in src/", () => {
    const violations = listTypeScriptFiles(SRC).flatMap((path) =>
      projectImports(SRC, path)
        .filter((target) => !isAllowedImport(path, target))
        .map((target) => `src/${path} imports src/${target}`),
    );
    expect(violations).toEqual([]);
  });

  it("keeps examples honest: they reach the twin over HTTP and never import src/", () => {
    const files = existsSync(EXAMPLES) ? listTypeScriptFiles(EXAMPLES).filter((path) => !path.endsWith(".test.ts")) : [];
    const violations = files.flatMap((path) =>
      findImports(readFileSync(join(EXAMPLES, path), "utf8"))
        .filter((specifier) => specifier.includes("/src/"))
        .map((specifier) => `examples/${path} imports ${specifier}`),
    );
    expect(violations).toEqual([]);
  });
});
