import { existsSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { type ConformanceCase, caseId, type Observations } from "./case.ts";
import type { Results } from "./run.ts";

/**
 * Recordings: what each case observed against a real vendor sandbox, one JSON file per vendor in recordings/.
 * They hold observations only (statuses, codes, shapes, yes/no facts), never tokens, Ids, names, or other data.
 */
export interface Recording {
  recordedAt: string;
  target: string; // which sandbox, in words: "QuickBooks Online sandbox company"
  cases: Record<string, Observations>;
}

type Vendor = ConformanceCase["vendor"];
const DIR = new URL("./recordings/", import.meta.url);
const file = (vendor: Vendor) => new URL(`${vendor}.json`, DIR);

export function readRecordings(): Partial<Record<Vendor, Recording>> {
  const recordings: Partial<Record<Vendor, Recording>> = {};
  for (const vendor of ["quickbooks", "jobber"] as const) {
    if (existsSync(file(vendor))) recordings[vendor] = JSON.parse(readFileSync(file(vendor), "utf8")) as Recording;
  }
  return recordings;
}

/** Saved whole or not at all: written beside the old file, then moved over it. */
export function writeRecording(vendor: Vendor, recording: Recording): string {
  const partial = new URL(`${vendor}.json.partial`, DIR);
  writeFileSync(partial, `${JSON.stringify(recording, null, 2)}\n`);
  renameSync(partial, file(vendor));
  return file(vendor).pathname;
}

/**
 * The recording a run leaves for one vendor's `cases`: what each observed this time, or, for one that couldn't run
 * this time, what it observed before (`kept`), so one bad run can't erase evidence. `missing` couldn't run and has
 * nothing earlier. Cases that no longer exist are dropped.
 */
export function nextRecording(
  previous: Recording | undefined,
  cases: ConformanceCase[],
  results: Results,
  recordedAt: string,
  target: string,
): { recording: Recording; kept: string[]; missing: string[] } {
  const recorded: Record<string, Observations> = {};
  const kept: string[] = [];
  const missing: string[] = [];
  for (const { vendor, name } of cases) {
    const result = results[caseId({ vendor, name })];
    if (result && !("error" in result)) recorded[name] = result;
    else if (previous?.cases[name]) {
      recorded[name] = previous.cases[name];
      kept.push(name);
    } else missing.push(name);
  }
  return { recording: { recordedAt, target, cases: recorded }, kept, missing };
}
