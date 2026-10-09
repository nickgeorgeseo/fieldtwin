import { generateWorld, type World, type WorldSize } from "../world/generate-world.ts";
import { TwinClock } from "./clock.ts";
import { EventLog } from "./event-log.ts";
import { type BucketLimits, LeakyBucket } from "./leaky-bucket.ts";
import { SeededRandom } from "./random.ts";
import type { Checkpoint, EventSource, FaultRule, NewEvent, TwinEvent, VendorName } from "./types.ts";
import type { VendorTwin } from "./vendor-twin.ts";

export interface TwinOptions {
  seed: number;
  startTime: string;
  worldSize?: Partial<WorldSize>;
  vendors: VendorTwin[];
}

/**
 * The running twin: one fake business, seen through several vendor APIs.
 *
 * Three rules keep this easy to reason about:
 *   1. All state changes go through record(). Nothing else writes vendor state.
 *   2. All time comes from this.clock. All randomness comes from a SeededRandom.
 *   3. Vendor state can always be rebuilt by replaying the event log.
 */
export class Twin {
  clock!: TwinClock;
  log!: EventLog;
  world!: World;
  faultRules: FaultRule[] = [];
  faultRandom!: SeededRandom; // separate stream, so faults never change the generated world

  private readonly vendors = new Map<VendorName, VendorTwin>();
  private states = new Map<VendorName, unknown>();
  private checkpoints = new Map<string, Checkpoint>();

  // Request bookkeeping, deliberately outside the event log: nothing about the fake business changes when
  // a rate-limit budget is spent, so it is not replayed. reset() and rewind() clear it, because the spending
  // it remembers belongs to a history that no longer exists.
  private rateLimits = new Map<string, LeakyBucket>();

  constructor(private options: TwinOptions) {
    for (const vendor of options.vendors) this.vendors.set(vendor.name, vendor);
    this.reset();
  }

  /** The single write path. Every change to every vendor's state goes through here. */
  record(event: NewEvent, source: EventSource): TwinEvent {
    const recorded = this.log.append({ ...event, at: this.clock.nowIso(), source });
    this.vendor(event.vendor).apply(this.state(event.vendor), recorded);
    return recorded;
  }

  vendor(name: VendorName): VendorTwin {
    const vendor = this.vendors.get(name);
    if (!vendor) throw new Error(`No vendor twin named "${name}" is loaded`);
    return vendor;
  }

  vendorNames(): VendorName[] {
    return [...this.vendors.keys()];
  }

  /** Read-only use, please. To change state, record an event. */
  state<State>(name: VendorName): State {
    return this.states.get(name) as State;
  }

  /** Switch to a different seed, start time, or world size, then reset. Used when loading a scenario. */
  reconfigure(changes: Partial<Omit<TwinOptions, "vendors">>): void {
    this.options = { ...this.options, ...changes };
    this.reset();
  }

  /** Back to the seeded starting world. Same seed and options give a byte-identical log. */
  reset(): void {
    const { seed, startTime, worldSize } = this.options;
    this.clock = new TwinClock(startTime);
    this.log = new EventLog();
    this.world = generateWorld(new SeededRandom(seed), { startTime, size: worldSize });
    this.faultRandom = new SeededRandom(seed + 1);
    this.faultRules = [];
    this.checkpoints.clear();
    this.rateLimits.clear();
    this.states = new Map([...this.vendors.values()].map((v) => [v.name, v.createState()]));

    for (const vendor of this.vendors.values()) {
      for (const event of vendor.seed(this.world)) this.record(event, "seed");
    }
  }

  /** The rate-limit budget for a key (e.g. one vendor app), created full on first use. */
  rateLimitBucket(key: string, limits: BucketLimits): LeakyBucket {
    let bucket = this.rateLimits.get(key);
    if (!bucket) {
      bucket = new LeakyBucket(limits);
      this.rateLimits.set(key, bucket);
    }
    return bucket;
  }

  checkpoint(name: string): Checkpoint {
    const checkpoint = { name, seq: this.log.length, time: this.clock.nowIso() };
    this.checkpoints.set(name, checkpoint);
    return checkpoint;
  }

  getCheckpoint(name: string): Checkpoint {
    const checkpoint = this.checkpoints.get(name);
    if (!checkpoint) throw new Error(`No checkpoint named "${name}"`);
    return checkpoint;
  }

  /** Everything recorded since a checkpoint. The answer to "what did my agent just do?" */
  changesSince(name: string): TwinEvent[] {
    return this.log.after(this.getCheckpoint(name).seq);
  }

  /** Go back to a checkpoint by replaying the log up to that point. */
  rewind(name: string): void {
    const checkpoint = this.getCheckpoint(name);
    const kept = this.log.all().slice(0, checkpoint.seq);

    this.log = new EventLog();
    this.states = new Map([...this.vendors.values()].map((v) => [v.name, v.createState()]));
    for (const event of kept) {
      const replayed = this.log.append(event);
      this.vendor(event.vendor).apply(this.state(event.vendor), replayed);
    }
    this.clock = new TwinClock(checkpoint.time);
    this.rateLimits.clear();

    // Checkpoints taken after this one point at history that no longer exists.
    for (const [otherName, other] of this.checkpoints) {
      if (other.seq > checkpoint.seq) this.checkpoints.delete(otherName);
    }
  }
}
