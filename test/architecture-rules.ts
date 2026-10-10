import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import ts from "typescript";

/**
 * Static checks for the rules in ARCHITECTURE.md. They parse source with the TypeScript compiler
 * instead of matching text, so comments and strings never cause false alarms.
 */

export interface Finding {
  line: number;
  text: string;
}

/** Wall-clock and unseeded-randomness APIs. Time comes from twin.clock, randomness from SeededRandom. */
const BANNED_PROPERTY_READS: Record<string, string[]> = {
  Date: ["now"],
  Math: ["random"],
  performance: ["now"],
  process: ["hrtime"],
  crypto: ["randomUUID", "randomBytes", "randomInt", "getRandomValues"],
};
const BANNED_CRYPTO_IMPORTS = new Set(["randomUUID", "randomBytes", "randomInt", "getRandomValues"]);

export function findNondeterminism(source: string, fileName = "source.ts"): Finding[] {
  const file = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true);
  const findings: Finding[] = [];
  const report = (node: ts.Node, text: string) =>
    findings.push({ line: file.getLineAndCharacterOfPosition(node.getStart()).line + 1, text });
  const cryptoAliases = cryptoModuleNames(file);
  /** What a banned read is reached through: `Date`, `globalThis.Date`, or a local name for node:crypto. */
  const bannedOf = (object: string | undefined) =>
    object && cryptoAliases.has(object) ? BANNED_PROPERTY_READS.crypto : object && BANNED_PROPERTY_READS[object];

  const visit = (node: ts.Node): void => {
    if (ts.isPropertyAccessExpression(node)) {
      const object = lastName(node.expression);
      if (bannedOf(object)?.includes(node.name.text)) report(node, `${object}.${node.name.text}`);
    }
    // const { now } = Date; const { random: roll } = Math
    if (ts.isVariableDeclaration(node) && ts.isObjectBindingPattern(node.name) && node.initializer) {
      const object = lastName(node.initializer);
      for (const element of node.name.elements) {
        const property = (element.propertyName ?? element.name).getText(file);
        if (bannedOf(object)?.includes(property)) report(element, `${object}.${property}`);
      }
    }
    // `new Date()` and `Date()` both read the wall clock. `new Date(value)` is fine.
    if ((ts.isNewExpression(node) || ts.isCallExpression(node)) && ts.isIdentifier(node.expression)) {
      if (node.expression.text === "Date" && (node.arguments?.length ?? 0) === 0) {
        report(node, ts.isNewExpression(node) ? "new Date()" : "Date()");
      }
    }
    if (ts.isImportDeclaration(node) && /^(node:)?crypto$/.test(moduleName(node) ?? "")) {
      const bindings = node.importClause?.namedBindings;
      if (bindings && ts.isNamedImports(bindings)) {
        for (const element of bindings.elements) {
          const imported = (element.propertyName ?? element.name).text;
          if (BANNED_CRYPTO_IMPORTS.has(imported)) report(element, `crypto ${imported}`);
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(file);
  return findings;
}

/** `Date` for `Date` and for `globalThis.Date`: the name a property is read from. */
function lastName(expression: ts.Expression): string | undefined {
  if (ts.isIdentifier(expression)) return expression.text;
  if (ts.isPropertyAccessExpression(expression)) return expression.name.text;
  return undefined;
}

/** Local names that stand for node:crypto as a whole: `import * as c`, `import c`, and `import { webcrypto }`. */
function cryptoModuleNames(file: ts.SourceFile): Set<string> {
  const names = new Set<string>();
  for (const statement of file.statements) {
    if (!ts.isImportDeclaration(statement) || !/^(node:)?crypto$/.test(moduleName(statement) ?? "")) continue;
    const clause = statement.importClause;
    if (clause?.name) names.add(clause.name.text);
    const bindings = clause?.namedBindings;
    if (bindings && ts.isNamespaceImport(bindings)) names.add(bindings.name.text);
    if (bindings && ts.isNamedImports(bindings)) {
      for (const element of bindings.elements)
        if ((element.propertyName ?? element.name).text === "webcrypto") names.add(element.name.text);
    }
  }
  return names;
}

/** Every module specifier a file imports or re-exports, including dynamic import("..."). */
export function findImports(source: string, fileName = "source.ts"): string[] {
  const file = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true);
  const specifiers: string[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) {
      const name = moduleName(node);
      if (name) specifiers.push(name);
    }
    if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword) {
      const [argument] = node.arguments;
      if (argument && ts.isStringLiteral(argument)) specifiers.push(argument.text);
    }
    ts.forEachChild(node, visit);
  };
  visit(file);
  return specifiers;
}

function moduleName(node: ts.ImportDeclaration | ts.ExportDeclaration): string | undefined {
  return node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier) ? node.moduleSpecifier.text : undefined;
}

/**
 * Which layer a file in src/ belongs to: "core", "world", "faults", "control", "vendors/<name>",
 * or "entry" for the top-level files (app.ts, server.ts, mcp.ts) that wire everything together.
 */
export function layerOf(pathFromSrc: string): string {
  const parts = pathFromSrc.split("/");
  if (parts.length === 1) return "entry";
  if (parts[0] === "vendors") return `vendors/${parts[1]}`;
  return parts[0]!;
}

/** The import rules from ARCHITECTURE.md, "Layers and who may import whom". */
export function isAllowedImport(fromPath: string, toPath: string): boolean {
  const from = layerOf(fromPath);
  const to = layerOf(toPath);
  if (from === "entry" || from === to) return true;
  switch (from) {
    case "world":
      return toPath === "core/random.ts";
    case "core":
      return to === "world";
    case "faults":
    case "control":
      return to === "core";
    default: // a vendor
      return to === "core" || to === "world";
  }
}

/** Project-relative imports of one file in src/, resolved to paths relative to src/. */
export function projectImports(srcRoot: string, pathFromSrc: string): string[] {
  const absolute = join(srcRoot, pathFromSrc);
  return findImports(readFileSync(absolute, "utf8"), absolute)
    .filter((specifier) => specifier.startsWith("."))
    .map((specifier) => relative(srcRoot, resolve(dirname(absolute), specifier)));
}

/** All .ts files under a directory, as paths relative to it. */
export function listTypeScriptFiles(root: string): string[] {
  return readdirSync(root, { recursive: true, encoding: "utf8" })
    .filter((path) => path.endsWith(".ts"))
    .map((path) => path.split("\\").join("/"))
    .sort();
}
