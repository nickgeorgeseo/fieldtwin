import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { findImports, isAllowedImport, listTypeScriptFiles, projectImports } from "./architecture-rules.ts";

const SRC = join(import.meta.dirname, "..", "src");
const EXAMPLES = join(import.meta.dirname, "..", "examples");
const CONFORMANCE = join(import.meta.dirname, "..", "conformance");
const DASHBOARD = join(import.meta.dirname, "..", "dashboard");

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

  it("tells the project's src/ apart from an example's own src/ folder", () => {
    const example = join(EXAMPLES, "some-example", "test", "harness.ts");
    expect(importsProjectSrc(example, "../../../src/app.ts")).toBe(true);
    expect(importsProjectSrc(example, "../src/retry.ts")).toBe(false);
    expect(importsProjectSrc(example, "vitest")).toBe(false);
  });

  it("lists .ts and .tsx files, but not installed packages or build output", () => {
    const root = mkdtempSync(join(tmpdir(), "fieldtwin-files-"));
    for (const path of ["app/page.tsx", "lib/twin.ts", "styles.css", "node_modules/next/index.ts", ".next/types/routes.ts"]) {
      mkdirSync(dirname(join(root, path)), { recursive: true });
      writeFileSync(join(root, path), "");
    }
    try {
      expect(listTypeScriptFiles(root)).toEqual(["app/page.tsx", "lib/twin.ts"]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it.each([
    ["examples", EXAMPLES],
    ["conformance", CONFORMANCE],
    ["dashboard", DASHBOARD],
  ])("keeps %s/ honest: it reaches the twin over HTTP and never imports src/ (its tests may)", (folder, root) => {
    const files = existsSync(root) ? listTypeScriptFiles(root).filter((path) => !/\.test\.tsx?$/.test(path)) : [];
    expect(files.length).toBeGreaterThan(0);
    const violations = files.flatMap((path) =>
      findImports(readFileSync(join(root, path), "utf8"), path)
        .filter((specifier) => importsProjectSrc(join(root, path), specifier))
        .map((specifier) => `${folder}/${path} imports ${specifier}`),
    );
    expect(violations).toEqual([]);
  });
});

/** Whether a file's import resolves into the project's src/. An example may have a src/ folder of its own. */
function importsProjectSrc(file: string, specifier: string): boolean {
  if (!specifier.startsWith(".")) return false;
  const fromSrc = relative(SRC, resolve(dirname(file), specifier));
  return !fromSrc.startsWith("..") && !isAbsolute(fromSrc);
}
