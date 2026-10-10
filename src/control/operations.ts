import { parseTwinTime } from "../core/clock.ts";
import { SeededRandom } from "../core/random.ts";
import type { Twin } from "../core/twin.ts";
import type { AuthMode, FaultRule, TwinEvent, VendorName } from "../core/types.ts";
import { scenarioActionOf } from "../core/vendor-twin.ts";
import { listScenarioFiles, parseFaultRules, parseScenario, parseWebhookSubscriptions, readScenarioFile, resolveAt } from "./scenario.ts";

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
    webhookSubscriptions: twin.webhooks.subscriptions.length,
    upcoming: twin.upcoming().map(({ atMs, vendor, action, params }) => ({ at: new Date(atMs).toISOString(), vendor, action, params })),
  };
}

export function resetTwin(twin: Twin) {
  twin.reset();
  return describeTwin(twin);
}

/**
 * Move twin time forward. Scheduled scenario events happen on the way, each at its own time, and the webhook
 * deliveries they cause (and any retries now due) have been answered by the time this resolves.
 */
const MAX_ADVANCE_MINUTES = 10 * 365 * 24 * 60; // ten years: far beyond any test, and far inside what a date can hold

export async function advanceClock(twin: Twin, minutes: number) {
  if (typeof minutes !== "number" || !(minutes >= 0 && minutes <= MAX_ADVANCE_MINUTES)) {
    throw new Error(`minutes must be a number from 0 to ${MAX_ADVANCE_MINUTES.toLocaleString("en-US")} (ten years)`);
  }
  const before = twin.log.length;
  twin.advance(minutes * 60_000);
  await twin.deliverWebhooks();
  return { twinTime: twin.clock.nowIso(), scenarioEvents: twin.log.length - before };
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

/**
 * Replace the webhook subscriptions: the URLs and topics an app would set up in each vendor's developer settings.
 * Like OAuth connections, they belong to the app, so they survive reset and rewind.
 */
export function setWebhooks(twin: Twin, value: unknown) {
  const subscriptions = parseWebhookSubscriptions(value);
  for (const subscription of subscriptions) {
    const topics = topicsOf(twin, subscription.vendor);
    const unknown = subscription.topics.filter((topic) => !topics.includes(topic));
    if (unknown.length) {
      throw new Error(`${subscription.vendor} can't send ${unknown.join(", ")}. Topics the twin sends: ${topics.join(", ") || "none yet"}`);
    }
  }
  twin.webhooks.subscriptions = subscriptions;
  return describeWebhooks(twin);
}

/** The subscriptions (without their secrets) and the latest deliveries, with how each one went. */
export function describeWebhooks(twin: Twin) {
  return {
    subscriptions: twin.webhooks.subscriptions.map(({ clientSecret: _secret, ...subscription }) => subscription),
    deliveries: twin.webhooks.deliveries(),
  };
}

function knownVendor(twin: Twin, name: string): VendorName {
  const vendor = twin.vendorNames().find((candidate) => candidate === name);
  if (!vendor) throw new Error(`No vendor named "${name}". Vendors: ${twin.vendorNames().join(", ")}`);
  return vendor;
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
  twin.faultRules = checkWebhookTopics(twin, parseFaultRules(rules));
  return { activeFaults: twin.faultRules.map((rule) => rule.name) };
}

/** Fault rules whose webhook topics the vendor really sends; a misspelled topic would otherwise never fire. */
function checkWebhookTopics(twin: Twin, rules: FaultRule[]): FaultRule[] {
  for (const rule of rules) {
    const topics = topicsOf(twin, rule.vendor);
    if (rule.webhook !== undefined && rule.webhook !== "*" && !topics.includes(rule.webhook)) {
      throw new Error(
        `Fault rule "${rule.name}": ${rule.vendor} never sends ${rule.webhook}. Topics the twin sends: ${topics.join(", ") || "none yet"}`,
      );
    }
  }
  return rules;
}

function topicsOf(twin: Twin, vendor: string): readonly string[] {
  return twin.vendor(knownVendor(twin, vendor)).webhooks?.topics ?? [];
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
 * timeline. Everything is checked before anything changes, so a scenario that fails to load leaves the twin as it was.
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
  twin.reconfigure({ seed: scenario.seed, startTime: scenario.startTime, worldSize, drift, faults });
  twin.authMode = scenario.auth ?? twin.defaultAuthMode;
  const utcOffsetHours = twin.world.company.utcOffsetHours;
  twin.schedule(entries.map(({ at, ...entry }) => ({ atMs: resolveAt(at, startMs, utcOffsetHours), ...entry })));
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
