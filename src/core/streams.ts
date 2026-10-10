import { SeededRandom } from "./random.ts";

/**
 * Every random stream a twin draws from, all made from its seed, so the same seed and the same requests give the
 * same run. Each has a seed of its own, so drawing from one never moves another: turning a fault on never changes
 * the generated world, issuing a token never changes a fault, and subscribing to webhooks (which adds deliveries to
 * roll for) never changes which requests fail.
 */
export const streams = {
  world: (seed: number) => new SeededRandom(seed),
  faults: (seed: number): FaultRandom => ({ requests: new SeededRandom(seed + 1), webhooks: new SeededRandom(seed * 7919 + 500) }),
  oauth: (seed: number, vendorIndex: number) => new SeededRandom(seed + 2 + vendorIndex),
  // One per scenario timeline entry, so an entry made due again by a rewind draws exactly what it drew before.
  timelineEntry: (seed: number, position: number) => new SeededRandom(seed * 7919 + 1000 + position),
};

/** The dice fault rules roll, for requests and for webhook deliveries. A checkpoint keeps a copy, to roll the same again. */
export interface FaultRandom {
  requests: SeededRandom;
  webhooks: SeededRandom;
}

export function copyFaultRandom({ requests, webhooks }: FaultRandom): FaultRandom {
  return { requests: requests.copy(), webhooks: webhooks.copy() };
}
