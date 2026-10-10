import { type ConformanceCase, caseId, type Observation, type Observations, type Target } from "./case.ts";
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
  differences: { key: string; recorded: Observation; twin: Observation }[];
}

/** How many of the recorded observations the twin makes too, and the ones it doesn't. */
export function compare(recorded: Observations, twin: Observations): Comparison {
  const differences: Comparison["differences"] = [];
  for (const [key, value] of Object.entries(recorded)) {
    if (JSON.stringify(twin[key] ?? null) !== JSON.stringify(value)) differences.push({ key, recorded: value, twin: twin[key] ?? null });
  }
  const total = Object.keys(recorded).length;
  return { matched: total - differences.length, total, differences };
}

/**
 * A plain-text fidelity report: each case with its score and differences, then a score per endpoint and overall.
 * Cases nobody has recorded yet are listed, so the gaps stay visible.
 */
export function report(cases: ConformanceCase[], twin: Results, recordings: Partial<Record<ConformanceCase["vendor"], Recording>>): string {
  const lines: string[] = [];
  const byEndpoint = new Map<string, { matched: number; total: number }>();
  let matched = 0;
  let total = 0;

  for (const testCase of cases) {
    const recording = recordings[testCase.vendor];
    const recorded = recording?.cases[testCase.name];
    const observed = twin[caseId(testCase)] ?? { error: "not run" };
    const label = `${testCase.vendor.padEnd(10)} ${testCase.name.padEnd(34)}`;
    if (!recorded) {
      lines.push(`${label} not recorded yet`);
      continue;
    }
    if ("error" in observed) {
      lines.push(`${label} the twin couldn't run it: ${observed.error}`);
      continue;
    }
    const result = compare(recorded, observed);
    matched += result.matched;
    total += result.total;
    const endpoint = byEndpoint.get(testCase.endpoint) ?? { matched: 0, total: 0 };
    byEndpoint.set(testCase.endpoint, { matched: endpoint.matched + result.matched, total: endpoint.total + result.total });
    lines.push(`${label} ${result.matched}/${result.total}${result.differences.length ? "" : "  matches"}`);
    for (const { key, recorded: real, twin: ours } of result.differences) {
      lines.push(
        `${" ".repeat(46)}${key}: real ${JSON.stringify(real)}, twin ${JSON.stringify(ours)}   (FIDELITY.md: ${testCase.fidelity})`,
      );
    }
  }

  lines.push("", "By endpoint:");
  for (const [endpoint, score] of byEndpoint) lines.push(`  ${endpoint.padEnd(34)} ${percent(score)}`);
  lines.push("", `Fidelity: ${total ? percent({ matched, total }) : "nothing recorded yet. Run npm run conformance:record."}`);
  return lines.join("\n");
}

function percent({ matched, total }: { matched: number; total: number }): string {
  return `${matched}/${total} observations match (${Math.round((100 * matched) / total)}%)`;
}
