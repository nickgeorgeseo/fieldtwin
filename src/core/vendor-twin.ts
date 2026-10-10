import type { Hono } from "hono";
import type { World } from "../world/generate-world.ts";
import type { SeededRandom } from "./random.ts";
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

  /** An error body in the vendor's own format, so injected faults look real. */
  errorBody(status: number, message: string, twin: Twin): unknown;

  /**
   * What a scenario timeline can make happen in this vendor, by name ("newClients", "payInvoices").
   * Optional: a vendor without actions simply can't be scripted. See "Scenario timelines" in ARCHITECTURE.md.
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
  const action = actions[name];
  if (!action) throw new Error(`${vendor.name} has no scenario action "${name}". Available: ${Object.keys(actions).join(", ") || "none"}`);
  return action;
}

/** One thing a scenario can make happen: check its parameters when the scenario loads, run it when it's due. */
export interface ScenarioAction<State = unknown> {
  /** Throw an Error saying what's wrong with `params`, so a bad scenario fails when it loads, not hours later. */
  check(params: unknown): void;
  /** The complete events to record, with source "scenario". Read state; never change it. */
  run(params: unknown, context: ScenarioActionContext<State>): NewEvent[];
}

export interface ScenarioActionContext<State> {
  state: State;
  world: World;
  random: SeededRandom; // a stream of its own per timeline entry, so a re-armed entry does the same thing again
  nowIso: string;
}
