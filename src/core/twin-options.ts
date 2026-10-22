import type { DriftOptions } from "../world/drift.ts";
import { generateWorld, type World, type WorldSize } from "../world/generate-world.ts";
import { TwinClock } from "./clock.ts";
import { streams } from "./streams.ts";
import type { AuthMode, FaultRule } from "./types.ts";
import type { VendorTwin } from "./vendor-twin.ts";
import type { WebhookSender } from "./webhooks.ts";

/** What a twin is made from: the seed and start that build its world, and the settings a scenario brings. */
export interface TwinOptions {
  seed: number;
  scenario?: string; // the loaded scenario's name, for status displays
  startTime: string;
  worldSize?: Partial<WorldSize>;
  drift?: DriftOptions;
  faults?: FaultRule[]; // a loaded scenario's: back on after every reset
  auth?: AuthMode;
  vendors: VendorTwin[];
  sendWebhook?: WebhookSender; // how deliveries reach your app: fetch, unless a test answers them itself
}

/**
 * The clock and world a twin with these options starts from. Built before the twin's history is replaced, so options
 * that can't make a world change nothing; an entry due at the start that throws is caught later, by startOver().
 */
export function startingPoint({ seed, startTime, worldSize, drift }: TwinOptions): { clock: TwinClock; world: World } {
  return { clock: new TwinClock(startTime), world: generateWorld(streams.world(seed), { startTime, size: worldSize, drift }) };
}
