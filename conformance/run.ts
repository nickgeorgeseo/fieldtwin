import { type ConformanceCase, caseId, type Observation, type Observations, type Target, VENDORS } from "./case.ts";
import type { Recording } from "./recordings.ts";

/** What each case observed, by caseId. A case that couldn't finish records why, instead of observations. */
export type Results = Record<string, Observations | { error: string }>;

export async function observeAll(target: Target, cases: ConformanceCase[]): Promise<Results> {
  const results: Results = {};
  for (const testCase of cases) {
    try {
      results[caseId(testCase)] = await testCase.observe(target);
    } catch (error) {
      results[caseId(testCase)] = { error: error instanceof Error ? error.message : String(error) };
    }
  }
  return results;
}

export interface Comparison {
  matched: number;
  total: number;
  differences: { key: string; recorded?: Observation; twin?: Observation }[]; // undefined: not observed at all
}

/**
 * How many observations the recording and the twin agree on, out of every one either made, and the ones they don't.
 * An observation only one side made is a difference, and so is null against nothing: a case that has grown an
 * observation since it was recorded needs recording again.
 */
export function compare(recorded: Observations, twin: Observations): Comparison {
  const differences: Comparison["differences"] = [];
  const keys = [...new Set([...Object.keys(recorded), ...Object.keys(twin)])];
  for (const key of keys) {
    if (JSON.stringify(recorded[key]) !== JSON.stringify(twin[key])) differences.push({ key, recorded: recorded[key], twin: twin[key] });
  }
  return { matched: keys.length - differences.length, total: keys.length, differences };
}

/** Every vendor's name takes the room of the longest, so case names line up whichever vendor they belong to. */
const VENDOR_WIDTH = Math.max(...VENDORS.map((vendor) => vendor.length));

/**
 * A plain-text fidelity report: each case with its score and differences, then a score per endpoint and overall.
 * Cases nobody has recorded yet are listed, so the gaps stay visible.
 */
export function report(cases: ConformanceCase[], twin: Results, recordings: Partial<Record<ConformanceCase["vendor"], Recording>>): string {
  const lines: string[] = [];
  // Per vendor and endpoint: two vendors may well have an endpoint by the same name.
  const byEndpoint = new Map<string, { matched: number; total: number }>();
  let matched = 0;
  let total = 0;

  for (const testCase of cases) {
    const recording = recordings[testCase.vendor];
    const recorded = recording?.cases[testCase.name];
    const observed = twin[caseId(testCase)] ?? { error: "not run" };
    const label = `${testCase.vendor.padEnd(VENDOR_WIDTH)} ${testCase.name.padEnd(34)}`;
    if (!recorded) {
      lines.push(`${label} not recorded yet`);
      continue;
    }
    // A recorded case the twin couldn't run matched nothing it was meant to: it counts, as zero.
    const result = "error" in observed ? { matched: 0, total: Object.keys(recorded).length, differences: [] } : compare(recorded, observed);
    matched += result.matched;
    total += result.total;
    const where = `${testCase.vendor.padEnd(VENDOR_WIDTH)} ${testCase.endpoint}`;
    const endpoint = byEndpoint.get(where) ?? { matched: 0, total: 0 };
    byEndpoint.set(where, { matched: endpoint.matched + result.matched, total: endpoint.total + result.total });
    if ("error" in observed) lines.push(`${label} 0/${result.total}  the twin couldn't run it: ${observed.error}`);
    else lines.push(`${label} ${result.matched}/${result.total}${result.differences.length ? "" : "  matches"}`);
    for (const { key, recorded: real, twin: ours } of result.differences) {
      lines.push(`${" ".repeat(label.length + 1)}${key}: real ${shown(real)}, twin ${shown(ours)}   (FIDELITY.md: ${testCase.fidelity})`);
    }
  }

  if (byEndpoint.size) lines.push("", "By endpoint:");
  for (const [where, score] of byEndpoint) lines.push(`  ${where.padEnd(VENDOR_WIDTH + 1 + 34)} ${percent(score)}`);
  lines.push("", `Fidelity: ${total ? percent({ matched, total }) : "nothing recorded yet. Run npm run conformance:record."}`);
  return lines.join("\n");
}

function shown(observation: Observation | undefined): string {
  return observation === undefined ? "nothing" : JSON.stringify(observation);
}

/** Rounded down, so nothing short of every observation reads as 100%. */
function percent({ matched, total }: { matched: number; total: number }): string {
  return `${matched}/${total} observations match (${Math.floor((100 * matched) / total)}%)`;
}
