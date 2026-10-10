import { existsSync, readFileSync, writeFileSync } from "node:fs";
import type { ConformanceCase, Observations } from "./case.ts";

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

export function writeRecording(vendor: Vendor, recording: Recording): string {
  writeFileSync(file(vendor), `${JSON.stringify(recording, null, 2)}\n`);
  return file(vendor).pathname;
}
