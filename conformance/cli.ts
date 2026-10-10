import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { fileURLToPath } from "node:url";
import { caseId } from "./case.ts";
import { CASES } from "./cases/index.ts";
import { checkTokens } from "./preflight.ts";
import { readRecordings, writeRecording } from "./recordings.ts";
import { observeAll, report } from "./run.ts";
import { sandboxTarget, twinTarget } from "./targets.ts";

/**
 *   npm run conformance                   score a fresh twin of its own against the recordings: per case, per
 *                                         endpoint, and overall. FIELDTWIN_URL scores a running twin instead (the
 *                                         cases write a few records to it, and any faults it has skew the score)
 *   npm run conformance:record            run every case against the real sandboxes in your environment variables
 *                                         (see targets.ts) and save what they observed to recordings/
 *   npm run conformance:record -- --dry-run   the same, printing the observations instead of saving them. The cases
 *                                         still run, so the ones marked `writes` still create their test records
 */
const [command, ...flags] = process.argv.slice(2);

async function score(): Promise<void> {
  if (process.env.FIELDTWIN_URL) return scoreTwinAt(process.env.FIELDTWIN_URL);
  const twin = await startFreshTwin();
  try {
    await scoreTwinAt(twin.url);
  } finally {
    twin.stop();
  }
}

async function scoreTwinAt(baseUrl: string): Promise<void> {
  const status = await fetch(`${baseUrl}/_twin`).catch(() => {
    throw new Error(`no twin answered at ${baseUrl}. Start one with npm start, or leave FIELDTWIN_URL unset to score a fresh twin.`);
  });
  const before = (await status.json()) as { authMode: string };
  try {
    const target = await twinTarget(baseUrl);
    console.log(report(CASES, await observeAll(target, CASES), readRecordings()));
  } finally {
    // twinTarget switched on real token checks; put the twin back the way it was.
    await fetch(`${baseUrl}/_twin/auth`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ mode: before.authMode }),
    });
  }
}

async function record(dryRun: boolean): Promise<void> {
  const { target, vendors } = sandboxTarget(process.env);
  if (/(^|\/\/)quickbooks\.api\.intuit\.com/.test(target.quickbooks.apiBase)) {
    throw new Error("QBO_API_BASE points at production QuickBooks. Cases write test records: record against a sandbox company only.");
  }
  await checkTokens(target, vendors);
  const cases = CASES.filter((testCase) => vendors.includes(testCase.vendor));
  const writes = cases.filter((testCase) => testCase.writes).map(caseId);
  console.log(`Recording ${cases.length} cases against ${vendors.join(" and ")}.`);
  if (writes.length) console.log(`These create records named "fieldtwin conformance ..." in the sandbox: ${writes.join(", ")}.`);

  const results = await observeAll(target, cases);
  for (const vendor of vendors) {
    const recorded: Record<string, Record<string, unknown>> = {};
    for (const testCase of cases.filter((candidate) => candidate.vendor === vendor)) {
      const result = results[caseId(testCase)]!;
      if ("error" in result) console.log(`  ${caseId(testCase)} couldn't run, so it isn't recorded: ${result.error}`);
      else recorded[testCase.name] = result;
    }
    const recording = {
      recordedAt: new Date().toISOString(),
      target: vendor === "quickbooks" ? "QuickBooks Online sandbox company" : "Jobber developer testing account",
      cases: recorded as Record<string, never>,
    };
    if (dryRun) console.log(JSON.stringify(recording, null, 2));
    else console.log(`Saved ${Object.keys(recorded).length} cases to ${writeRecording(vendor, recording)}`);
  }
}

/** A twin of this checkout's own on a free port, so scoring never changes yours. Stopped once the score is printed. */
async function startFreshTwin(): Promise<{ url: string; stop: () => void }> {
  const port = await new Promise<number>((resolve) => {
    const probe = createServer().listen(0, "127.0.0.1", () => {
      const address = probe.address();
      probe.close(() => resolve(typeof address === "object" && address ? address.port : 0));
    });
  });
  const server = fileURLToPath(new URL("../src/server.ts", import.meta.url));
  const child = spawn(process.execPath, ["--import", "tsx", server], {
    env: { ...process.env, FIELDTWIN_PORT: String(port), FIELDTWIN_HOST: "127.0.0.1" },
    stdio: ["ignore", "ignore", "pipe"],
  });
  await new Promise<void>((resolve, reject) => {
    let output = "";
    child.stderr.on("data", (chunk) => {
      output += chunk;
      if (output.includes("open for business")) resolve();
    });
    child.on("exit", () => reject(new Error(`the twin didn't start:\n${output}`)));
  });
  return { url: `http://127.0.0.1:${port}`, stop: () => child.kill() };
}

const run = command === "record" ? record(flags.includes("--dry-run")) : score();
run.catch((error: Error) => {
  console.error(`conformance: ${error.message}`);
  process.exitCode = 1;
});
