import type { Twin } from "../core/twin.ts";
import type { TwinEvent } from "../core/types.ts";
import { parseFaultRules, parseScenario } from "./scenario.ts";

/**
 * Everything you can do to a running twin from the outside.
 *
 * The HTTP control plane, the MCP server, and the tests all call these same functions,
 * so there is exactly one implementation of each operation.
 */

export function describeTwin(twin: Twin) {
  return {
    company: twin.world.company,
    twinTime: twin.clock.nowIso(),
    eventCount: twin.log.length,
    vendors: twin.vendorNames(),
    activeFaults: twin.faultRules.map((rule) => rule.name),
  };
}

export function resetTwin(twin: Twin) {
  twin.reset();
  return describeTwin(twin);
}

export function advanceClock(twin: Twin, minutes: number) {
  twin.clock.advance(minutes * 60_000);
  return { twinTime: twin.clock.nowIso() };
}

export function createCheckpoint(twin: Twin, name: string) {
  return twin.checkpoint(name);
}

/** Plain-language list of what changed since a checkpoint, newest last. */
export function listChanges(twin: Twin, checkpointName: string, options: { onlyFromApi?: boolean } = {}) {
  const changes = twin.changesSince(checkpointName).filter((event) => !options.onlyFromApi || event.source === "api");
  return changes.map((event) => ({ ...event, summary: summarize(event) }));
}

export function rewindTo(twin: Twin, checkpointName: string) {
  twin.rewind(checkpointName);
  return describeTwin(twin);
}

/** Replace the active fault rules. Rules are validated first, so a bad rule never half-applies. */
export function setFaults(twin: Twin, rules: unknown) {
  twin.faultRules = parseFaultRules(rules);
  return { activeFaults: twin.faultRules.map((rule) => rule.name) };
}

/** Rebuild the twin from a scenario file's seed, start time, and world size, then turn on its faults. */
export function loadScenario(twin: Twin, yamlText: string) {
  const scenario = parseScenario(yamlText);
  twin.reconfigure({ seed: scenario.seed, startTime: scenario.startTime, worldSize: scenario.world });
  twin.faultRules = scenario.faults;
  return { scenario: scenario.name, ...describeTwin(twin) };
}

export function exportLog(twin: Twin): string {
  return twin.log.toJsonl();
}

function summarize(event: TwinEvent): string {
  const data = event.data as Record<string, any>;
  const record = data.customer ?? data.client;
  const label = record?.DisplayName ?? (record ? `${record.firstName} ${record.lastName}` : "");
  return `${event.at}  ${event.vendor}  ${event.type}${label ? `  "${label}"` : ""}  (${event.source})`;
}
