import { caseId } from "./case.ts";
import { CASES } from "./cases/index.ts";
import { readRecordings, writeRecording } from "./recordings.ts";
import { observeAll, report } from "./run.ts";
import { sandboxTarget, twinTarget } from "./targets.ts";

/**
 *   npm run conformance                   score the twin at FIELDTWIN_URL (default http://localhost:4010) against the
 *                                         recordings: per case, per endpoint, and overall
 *   npm run conformance:record            run every case against the real sandboxes in your environment variables
 *                                         (see targets.ts) and save what they observed to recordings/
 *   npm run conformance:record -- --dry-run   the same, printing the observations instead of saving them
 */
const [command, ...flags] = process.argv.slice(2);

async function score(): Promise<void> {
  const baseUrl = process.env.FIELDTWIN_URL ?? "http://localhost:4010";
  const before = (await (await fetch(`${baseUrl}/_twin`)).json()) as { authMode: string };
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

const run = command === "record" ? record(flags.includes("--dry-run")) : score();
run.catch((error: Error) => {
  console.error(`conformance: ${error.message}`);
  process.exitCode = 1;
});
