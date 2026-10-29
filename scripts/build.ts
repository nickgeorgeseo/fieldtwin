import { execFileSync } from "node:child_process";
import { cpSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * `npm run build`, which `npm pack` and `npm publish` run first: compiles src/ to dist/ for plain Node, so the
 * package runs without tsx. The source imports .ts files; TypeScript rewrites them to .js as it compiles.
 */
const ROOT = join(import.meta.dirname, "..");
const DIST = join(ROOT, "dist");

rmSync(DIST, { recursive: true, force: true }); // a file deleted from src/ mustn't live on in the package
execFileSync(process.execPath, [fileURLToPath(import.meta.resolve("typescript/bin/tsc")), "-p", join(ROOT, "tsconfig.build.json")], {
  stdio: "inherit",
});

// Jobber's GraphQL schema is read at startup from the folder beside graphql.ts.
cpSync(join(ROOT, "src/vendors/jobber/schema"), join(DIST, "vendors/jobber/schema"), { recursive: true });

// Keep only the type declarations that index.d.ts reaches: what `import ... from "fieldtwin"` can name. The rest, the
// Jobber resolvers' inferred GraphQL types above all, come to megabytes that no one who installs the package reads.
const reached = new Set<string>();
const toVisit = [join(DIST, "index.d.ts")];
for (let file = toVisit.pop(); file; file = toVisit.pop()) {
  if (reached.has(file)) continue;
  reached.add(file);
  for (const [, specifier] of readFileSync(file, "utf8").matchAll(/(?:from |import\()"(\.{1,2}\/[^"]+)"/g)) {
    toVisit.push(join(dirname(file), specifier!.replace(/\.[jt]s$/, ".d.ts")));
  }
}
for (const file of readdirSync(DIST, { recursive: true, encoding: "utf8" })) {
  if (file.endsWith(".d.ts") && !reached.has(join(DIST, file))) rmSync(join(DIST, file));
}
