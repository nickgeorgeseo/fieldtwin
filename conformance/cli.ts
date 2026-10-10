import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { fileURLToPath } from "node:url";
import { caseId } from "./case.ts";
import { CASES } from "./cases/index.ts";
import { parseCommand } from "./command.ts";
import { checkTokens } from "./preflight.ts";
import { nextRecording, readRecordings, writeRecording } from "./recordings.ts";
import { observeAll, report } from "./run.ts";
import { runningTwin, sandboxTarget, twinTarget } from "./targets.ts";

/**
 *   npm run conformance                   score a fresh twin of its own against the recordings: per case, per
 *                                         endpoint, and overall. FIELDTWIN_URL scores a running twin instead (the
 *                                         cases write a few records to it, and any faults it has skew the score)
 *   npm run conformance:record            run every case against the real sandboxes in your environment variables
 *                                         (see targets.ts) and save what they observed to recordings/
 *   npm run conformance:record -- --dry-run   the same, printing the observations instead of saving them. The cases
 *                                         still run, so the ones marked `writes` still create their test records
 */

async function score(): Promise<void> {
  if (process.env.FIELDTWIN_URL) return scoreTwinAt(process.env.FIELDTWIN_URL);
  const twin = await startFreshTwin();
  try {
    await scoreTwinAt(twin.url);
  } finally {
    twin.stop();
  }
}

async function scoreTwinAt(url: string): Promise<void> {
  const { baseUrl, authMode } = await runningTwin(url);
  try {
    const target = await twinTarget(baseUrl);
    console.log(report(CASES, await observeAll(target, CASES), readRecordings()));
  } finally {
    // twinTarget switched on real token checks; put the twin back the way it was.
    await fetch(`${baseUrl}/_twin/auth`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ mode: authMode }),
    });
  }
}

async function record(dryRun: boolean): Promise<void> {
  const { target, vendors } = sandboxTarget(process.env);
  await checkTokens(target, vendors);
  const cases = CASES.filter((testCase) => vendors.includes(testCase.vendor));
  const writes = cases.filter((testCase) => testCase.writes).map(caseId);
  console.log(`Recording ${cases.length} cases against ${vendors.join(" and ")}.`);
  if (writes.length) console.log(`These create records named "fieldtwin conformance ..." in the sandbox: ${writes.join(", ")}.`);

  const results = await observeAll(target, cases);
  const earlier = readRecordings();
  let incomplete = false;
  for (const vendor of vendors) {
    const vendorCases = cases.filter((candidate) => candidate.vendor === vendor);
    for (const testCase of vendorCases) {
      const result = results[caseId(testCase)]!;
      if ("error" in result) console.log(`  ${caseId(testCase)} couldn't run: ${result.error}`);
    }
    const name = vendor === "quickbooks" ? "QuickBooks Online sandbox company" : "Jobber developer testing account";
    const { recording, kept, missing } = nextRecording(earlier[vendor], vendorCases, results, new Date().toISOString(), name);
    if (kept.length) console.log(`  Kept the earlier recording of ${kept.join(", ")}.`);
    if (missing.length) console.log(`  Not recorded: ${missing.join(", ")}.`);
    incomplete ||= kept.length + missing.length > 0;
    if (dryRun) console.log(JSON.stringify(recording, null, 2));
    else console.log(`Saved ${Object.keys(recording.cases).length} cases to ${writeRecording(vendor, recording)}`);
  }
  if (incomplete) throw new Error("some cases couldn't run (above). Fix what they say and record again.");
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
  // tsx as this checkout has it: `--import tsx` alone would look for it in whatever folder the score was run from.
  const child = spawn(process.execPath, ["--import", import.meta.resolve("tsx"), server], {
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

async function main(): Promise<void> {
  const asked = parseCommand(process.argv.slice(2), process.env);
  return asked.command === "record" ? record(asked.dryRun) : score();
}

main().catch((error: Error) => {
  console.error(`conformance: ${error.message}`);
  process.exitCode = 1;
});
