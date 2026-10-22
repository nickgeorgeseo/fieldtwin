import type { Hono } from "hono";
import type { World } from "../world/generate-world.ts";
import type { SeededRandom } from "./random.ts";
import { shown } from "./request-body.ts";
import type { Twin } from "./twin.ts";
import type { NewEvent, TwinEvent, VendorName } from "./types.ts";
import type { VendorWebhooks } from "./webhooks.ts";

/**
 * The contract every vendor twin implements. Adding a vendor means adding one folder
 * under src/vendors/ that exports an object of this shape, then listing it in src/app.ts.
 *
 * Vendor folders never import from each other. Anything two vendors share belongs in core/ or world/.
 */
export interface VendorTwin<State = unknown> {
  name: VendorName;

  /** URL prefix this vendor's real API lives under, e.g. "/v3". Two vendors may not share one. */
  pathPrefix: string;

  /** A fresh, empty state object. */
  createState(): State;

  /**
   * Update state for one event. This is the ONLY place vendor state changes,
   * and it must be deterministic: same events in, same state out.
   */
  apply(state: State, event: TwinEvent): void;

  /**
   * One plain-language line about one of this vendor's events, e.g. `CustomerUpdated Id=1 "Ada Alder" SyncToken=2`.
   * This is how change lists and MCP tools explain events without control/ knowing any payload shape.
   */
  describeEvent(event: TwinEvent): string;

  /** Turn the shared fake business into this vendor's starting records. */
  seed(world: World): NewEvent[];

  /** HTTP routes shaped like the vendor's real API, mounted at the server root. */
  routes(twin: Twin): Hono;

  /** An error body in the vendor's own format, so injected faults look real and the twin's own bugs stay readable. */
  errorBody(status: number, message: string, twin: Twin): unknown;

  /**
   * Headers the vendor sends with an error of this status, like Housecall Pro's `RateLimit-Reset` on a 429, so an
   * injected fault carries them too. Called only by the fault middleware: a vendor's own routes add their headers
   * themselves. Return {} for a status that carries none. Content-Type and X-Twin-Fault are set by the middleware,
   * and win. Optional: a vendor without it sends only the body.
   */
  errorHeaders?(status: number, twin: Twin): Record<string, string>;

  /**
   * What a scenario timeline can make happen in this vendor, by name ("newClients", "payInvoices").
   * Optional: a vendor without actions simply can't be scripted. See "Scenario timelines" in ARCHITECTURE.md.
   * An action that takes a count shares its pieces: checkCount (below) reads the count, and world's newCustomers
   * names the people, so every vendor's new customers are checked and named the same way.
   */
  scenarioActions?: Record<string, ScenarioAction<State>>;

  /**
   * The webhooks this vendor sends: its topics, which events announce what, and how a delivery is shaped and signed.
   * Optional: a vendor without webhooks never sends any. See core/webhooks.ts.
   */
  webhooks?: VendorWebhooks<State>;
}

/** A vendor's scenario action by name, or an error naming the ones it has. */
export function scenarioActionOf(vendor: VendorTwin, name: string): ScenarioAction {
  const actions = vendor.scenarioActions ?? {};
  // Its own actions only: "constructor" and "toString" are on every object, and aren't actions.
  const action = Object.hasOwn(actions, name) ? actions[name] : undefined;
  if (!action) throw new Error(`${vendor.name} has no scenario action "${name}". Available: ${Object.keys(actions).join(", ") || "none"}`);
  return action;
}

/**
 * Checks an action's parameter that says how many ("payInvoices: 2"): a whole number of 1 or more, and at most `most`
 * when the action makes that many records. Throws an Error naming the vendor and action, for check() to pass on.
 */
export function checkCount(vendor: VendorName, action: string, value: unknown, most?: number): void {
  if (!Number.isInteger(value) || (value as number) < 1 || (most !== undefined && (value as number) > most)) {
    const range = most === undefined ? "of 1 or more" : `from 1 to ${most.toLocaleString("en-US")}`;
    throw new Error(`${vendor} ${action} takes how many: a whole number ${range}, not ${shown(value)}`);
  }
}

/** One thing a scenario can make happen: check its parameters when the scenario loads, run it when it's due. */
export interface ScenarioAction<State = unknown> {
  /** Throw an Error saying what's wrong with `params`, so a bad scenario fails when it loads, not hours later. */
  check(params: unknown): void;
  /**
   * The complete events to record, with source "scenario". Read state; never change it. Throwing here is a bug:
   * check() passed. The entry then records nothing and stays due, and the caller gets a ScenarioEntryError naming it.
   */
  run(params: unknown, context: ScenarioActionContext<State>): NewEvent[];
}

export interface ScenarioActionContext<State> {
  state: State;
  world: World;
  random: SeededRandom; // a stream of its own per timeline entry, so a re-armed entry does the same thing again
  nowIso: string;
}
