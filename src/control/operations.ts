import type { Twin } from "../core/twin.ts";
import type { AuthMode, TwinEvent, VendorName } from "../core/types.ts";
import { listScenarioFiles, parseFaultRules, parseScenario, readScenarioFile, resolveAt } from "./scenario.ts";

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
    authMode: twin.authMode,
    activeFaults: twin.faultRules.map((rule) => rule.name),
    upcoming: twin.upcoming().map(({ atMs, vendor, action, params }) => ({ at: new Date(atMs).toISOString(), vendor, action, params })),
  };
}

export function resetTwin(twin: Twin) {
  twin.reset();
  return describeTwin(twin);
}

/** Move twin time forward. Scheduled scenario events happen on the way, each at its own time. */
export function advanceClock(twin: Twin, minutes: number) {
  if (typeof minutes !== "number" || !(minutes >= 0)) throw new Error("minutes must be a number, 0 or more");
  const before = twin.log.length;
  twin.advance(minutes * 60_000);
  return { twinTime: twin.clock.nowIso(), scenarioEvents: twin.log.length - before };
}

export function createCheckpoint(twin: Twin, name: string) {
  return twin.checkpoint(name);
}

/** Plain-language list of what changed since a checkpoint, newest last. */
export function listChanges(twin: Twin, checkpointName: string, options: { onlyFromApi?: boolean } = {}) {
  const changes = twin.changesSince(checkpointName).filter((event) => !options.onlyFromApi || event.source === "api");
  return changes.map((event) => ({ ...event, summary: summarize(twin, event) }));
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

/**
 * Choose how the vendor APIs treat bearer tokens: "any-token" accepts anything (quick local use), "oauth"
 * accepts only unexpired tokens from the twin's OAuth servers. Connections made earlier keep working.
 */
export function setAuthMode(twin: Twin, mode: unknown) {
  twin.authMode = parseAuthMode(mode);
  return { authMode: twin.authMode };
}

export function parseAuthMode(mode: unknown): AuthMode {
  if (mode === "any-token" || mode === "oauth") return mode;
  throw new Error(`Unknown auth mode "${String(mode)}". Use "any-token" or "oauth".`);
}

/** Rebuild the twin from a scenario file's seed, start time, and world size, then turn on its faults. */
export function loadScenario(twin: Twin, yamlText: string) {
  const scenario = parseScenario(yamlText);
  const { drift, ...worldSize } = scenario.world ?? {};
  twin.reconfigure({ seed: scenario.seed, startTime: scenario.startTime, worldSize, drift });
  twin.faultRules = scenario.faults;
  if (scenario.auth) twin.authMode = scenario.auth;

  const startMs = twin.clock.nowMs();
  const timeline = scenario.timeline.flatMap(({ at, ...byVendor }) => {
    const atMs = resolveAt(at, startMs, twin.world.company.utcOffsetHours);
    return Object.entries(byVendor).flatMap(([vendor, actions]) =>
      Object.entries(actions ?? {}).map(([action, params]) => ({ atMs, vendor: vendor as VendorName, action, params })),
    );
  });
  twin.schedule(timeline);
  return { scenario: scenario.name, ...describeTwin(twin) };
}

/** The ready-made scenarios, with what each one is for. */
export function listScenarios() {
  return listScenarioFiles();
}

/** Load a ready-made scenario by name ("flaky-apis"). */
export function loadScenarioByName(twin: Twin, name: string) {
  return loadScenario(twin, readScenarioFile(name));
}

/** The event log as JSON Lines: everything, or only what happened since a checkpoint. */
export function exportLog(twin: Twin, options: { sinceCheckpoint?: string } = {}): string {
  const events = options.sinceCheckpoint ? twin.changesSince(options.sinceCheckpoint) : twin.log.all();
  return events.map((event) => JSON.stringify(event)).join("\n");
}

function summarize(twin: Twin, event: TwinEvent): string {
  return `${event.at}  ${event.vendor}  ${twin.vendor(event.vendor).describeEvent(event)}  (${event.source})`;
}
