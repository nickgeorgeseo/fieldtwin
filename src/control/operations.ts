import { parseTwinTime } from "../core/clock.ts";
import { SeededRandom } from "../core/random.ts";
import type { Twin } from "../core/twin.ts";
import type { AuthMode, EventSource, TwinEvent, VendorName } from "../core/types.ts";
import { scenarioActionOf } from "../core/vendor-twin.ts";
import { listScenarioFiles, parseFaultRules, parseScenario, readScenarioFile, resolveAt } from "./scenario.ts";
import { checkWebhookTopics, knownVendor } from "./webhook-operations.ts";

/**
 * Everything you can do to a running twin from the outside.
 *
 * The HTTP control plane, the MCP server, and the tests all call these same functions,
 * so there is exactly one implementation of each operation.
 */

// The webhook operations live in a file of their own, and are offered here with the rest.
export { describeWebhooks, setWebhooks } from "./webhook-operations.ts";

export function describeTwin(twin: Twin) {
  return {
    company: twin.world.company,
    seed: twin.seed,
    scenario: twin.scenario ?? null,
    twinTime: twin.clock.nowIso(),
    eventCount: twin.log.length,
    vendors: twin.vendorNames(),
    authMode: twin.authMode,
    activeFaults: twin.faultRules.map((rule) => rule.name),
    webhookSubscriptions: twin.webhooks.subscriptions.length,
    checkpoints: twin.checkpointList().map(({ name, time }) => ({ name, time })),
    upcoming: twin.upcoming().map(({ atMs, vendor, action, params }) => ({ at: new Date(atMs).toISOString(), vendor, action, params })),
  };
}

export function resetTwin(twin: Twin) {
  twin.reset();
  return describeTwin(twin);
}

/**
 * Move twin time forward. Scheduled scenario events happen on the way, each at its own time, and the webhook
 * deliveries they cause (and any retries now due) have been answered by the time this resolves. An entry whose action
 * throws stops the clock at its time, still due (ARCHITECTURE.md, "Scenario timelines").
 */
const MAX_ADVANCE_MINUTES = 10 * 365 * 24 * 60; // ten years: far beyond any test, and far inside what a date can hold

export async function advanceClock(twin: Twin, minutes: number) {
  if (typeof minutes !== "number" || !(minutes >= 0 && minutes <= MAX_ADVANCE_MINUTES)) {
    throw new Error(`minutes must be a number from 0 to ${MAX_ADVANCE_MINUTES.toLocaleString("en-US")} (ten years)`);
  }
  const before = twin.log.length;
  try {
    twin.advance(minutes * 60_000);
  } catch (error) {
    await twin.deliverWebhooks(); // what happened on the way, before the entry that failed, is news all the same
    throw error;
  }
  const scenarioEvents = twin.log.length - before; // counted now: API writes may arrive while webhooks go out
  await twin.deliverWebhooks();
  return { twinTime: twin.clock.nowIso(), scenarioEvents };
}

/**
 * Make one of a vendor's scenario actions happen now, as if someone did it in the vendor's own app: customers pay
 * (`jobber`, `payInvoices`, 2), clients call in. Recorded with source "control"; webhooks go out before this resolves.
 */
export async function runAction(twin: Twin, vendorName: string, action: string, params: unknown) {
  const vendor = twin.vendor(knownVendor(twin, vendorName));
  const scenarioAction = scenarioActionOf(vendor, action);
  scenarioAction.check(params);
  // Seeded by the history so far, so the same requests make the same clients.
  const context = {
    state: twin.state(vendor.name),
    world: twin.world,
    random: new SeededRandom(twin.log.length),
    nowIso: twin.clock.nowIso(),
  };
  const recorded = scenarioAction.run(params, context).map((event) => twin.record(event, "control"));
  await twin.deliverWebhooks();
  return { events: recorded.map((event) => summarize(twin, event)) };
}

export function createCheckpoint(twin: Twin, name: string) {
  return twin.checkpoint(name);
}

const SOURCES: readonly EventSource[] = ["seed", "scenario", "api", "control"];

/** Plain-language list of what changed since a checkpoint, newest last: everything or one source's, after a position if given. */
export function listChanges(twin: Twin, checkpointName: string, options: { onlyFromApi?: boolean; source?: string; after?: string } = {}) {
  const source = options.onlyFromApi ? "api" : options.source;
  if (source !== undefined && !SOURCES.includes(source as EventSource)) {
    throw new Error(`source must be one of ${SOURCES.join(", ")}, not "${source}"`);
  }
  const after = options.after ? twin.log.seqAt(options.after) : 0;
  const changes = twin.changesSince(checkpointName, after).filter((event) => source === undefined || event.source === source);
  return changes.map((event) => ({ ...event, summary: summarize(twin, event) }));
}

export function rewindTo(twin: Twin, checkpointName: string) {
  twin.rewind(checkpointName);
  return describeTwin(twin);
}

/** Replace the active fault rules. Rules are validated first, so a bad rule never half-applies. */
export function setFaults(twin: Twin, rules: unknown) {
  twin.faultRules = checkWebhookTopics(twin, parseFaultRules(rules));
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

/**
 * Rebuild the twin from a scenario file's seed, start time, and world size, then turn on its faults and schedule its
 * timeline. Everything is checked before anything changes, and the twin rebuilds all or nothing, so a scenario that
 * fails to load leaves the twin as it was.
 */
export function loadScenario(twin: Twin, yamlText: string) {
  const scenario = parseScenario(yamlText);
  const faults = checkWebhookTopics(twin, scenario.faults);
  const startMs = parseTwinTime(scenario.startTime) ?? Number.NaN; // the schema has checked it
  const entries = scenario.timeline.flatMap(({ at, ...byVendor }) => {
    resolveAt(at, startMs, 0); // a time it can't read fails now; local times are resolved once the world is known
    return Object.entries(byVendor).flatMap(([vendor, actions]) =>
      Object.entries(actions ?? {}).map(([action, params]) => ({ at, vendor: vendor as VendorName, action, params })),
    );
  });
  for (const { vendor, action, params } of entries) scenarioActionOf(twin.vendor(vendor), action).check(params);

  const { drift, ...worldSize } = scenario.world ?? {};
  twin.load({ seed: scenario.seed, scenario: scenario.name, startTime: scenario.startTime, worldSize, drift, faults }, (world) =>
    entries.map(({ at, ...entry }) => ({ atMs: resolveAt(at, startMs, world.company.utcOffsetHours), ...entry })),
  );
  twin.authMode = scenario.auth ?? twin.defaultAuthMode;
  return describeTwin(twin); // its `scenario` is the name just loaded
}

/** The ready-made scenarios, with what each one is for. */
export function listScenarios() {
  return listScenarioFiles();
}

/** Load a ready-made scenario by name ("flaky-apis"). */
export function loadScenarioByName(twin: Twin, name: string) {
  return loadScenario(twin, readScenarioFile(name));
}

/** The event log as JSON Lines (all of it, since a checkpoint, or after an earlier read's position), and where it ends. */
export function exportLog(twin: Twin, { sinceCheckpoint, after }: { sinceCheckpoint?: string; after?: string } = {}) {
  if (sinceCheckpoint && after) throw new Error("Give since (a checkpoint) or after (a position), not both.");
  const events = after ? twin.log.after(twin.log.seqAt(after)) : sinceCheckpoint ? twin.changesSince(sinceCheckpoint) : twin.log.all();
  return { jsonl: events.map((event) => JSON.stringify(event)).join("\n"), position: twin.log.position() };
}

function summarize(twin: Twin, event: TwinEvent): string {
  return `${event.at}  ${event.vendor}  ${twin.vendor(event.vendor).describeEvent(event)}  (${event.source})`;
}
