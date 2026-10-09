import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { findNondeterminism, listTypeScriptFiles } from "./architecture-rules.ts";

const SRC = join(import.meta.dirname, "..", "src");

describe("rule 2: time comes from twin.clock, randomness from SeededRandom", () => {
  it("catches wall-clock reads and unseeded randomness", () => {
    const source = [
      "const a = Date.now();",
      "const b = Math.random();",
      "const c = new Date();",
      "const d = Date();",
      "const e = performance.now();",
      "const f = crypto.randomUUID();",
      'import { randomBytes } from "node:crypto";',
    ].join("\n");
    expect(findNondeterminism(source).map((finding) => finding.text)).toEqual([
      "Date.now",
      "Math.random",
      "new Date()",
      "Date()",
      "performance.now",
      "crypto.randomUUID",
      "crypto randomBytes",
    ]);
  });

  it("allows dates built from a value, and ignores comments and strings", () => {
    const source = [
      "// Never call Date.now() or Math.random() here.",
      "const parsed = new Date(twin.clock.nowMs());",
      'const message = "do not use new Date()";',
      'import { createHash } from "node:crypto";',
    ].join("\n");
    expect(findNondeterminism(source)).toEqual([]);
  });

  it("finds none of them anywhere in src/", () => {
    const violations = listTypeScriptFiles(SRC).flatMap((path) =>
      findNondeterminism(readFileSync(join(SRC, path), "utf8"), path).map((finding) => `src/${path}:${finding.line}  ${finding.text}`),
    );
    expect(violations).toEqual([]);
  });
});
