import type { DriftOptions } from "../world/drift.ts";
import { generateWorld, type World, type WorldSize } from "../world/generate-world.ts";
import { Bookkeeping } from "./bookkeeping.ts";
import { TwinClock } from "./clock.ts";
import { EventLog } from "./event-log.ts";
import type { BucketLimits, LeakyBucket } from "./leaky-bucket.ts";
import type { OAuthPolicy, OAuthServer } from "./oauth.ts";
import { SeededRandom } from "./random.ts";
import { Timeline, type TimelineEntry } from "./timeline.ts";
import type { AuthMode, Checkpoint, EventSource, FaultRule, NewEvent, TwinEvent, VendorName } from "./types.ts";
import type { VendorTwin } from "./vendor-twin.ts";

export interface TwinOptions {
  seed: number;
  startTime: string;
  worldSize?: Partial<WorldSize>;
  drift?: DriftOptions;
  auth?: AuthMode;
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
  authMode: AuthMode;
  faultRandom!: SeededRandom; // separate stream, so faults never change the generated world

  private readonly vendors = new Map<VendorName, VendorTwin>();
  private states = new Map<VendorName, unknown>();
  private checkpoints = new Map<string, Checkpoint>();

  // Rate-limit budgets and OAuth grants: request bookkeeping, outside the event log. See bookkeeping.ts.
  // Each vendor's OAuth server draws from its own stream, so issuing tokens never changes the world or the faults.
  private readonly bookkeeping = new Bookkeeping(
    (vendor) => new SeededRandom(this.options.seed + 2 + [...this.vendors.keys()].indexOf(vendor)),
  );

  // A loaded scenario's schedule. See schedule() and advance().
  private timeline = new Timeline();

  constructor(private options: TwinOptions) {
    for (const vendor of options.vendors) this.vendors.set(vendor.name, vendor);
    this.authMode = options.auth ?? "any-token";
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
    this.timeline.schedule([]); // the old scenario's schedule doesn't belong in the new world
    this.reset();
  }

  /** Schedule a scenario's timeline, replacing any other, and apply the entries already due. */
  schedule(entries: TimelineEntry[]): void {
    for (const entry of entries) this.scenarioAction(entry).check(entry.params);
    this.timeline.schedule(entries);
    this.runDue(this.clock.nowMs());
  }

  /** Move twin time forward, applying scheduled entries at their own times on the way. */
  advance(milliseconds: number): void {
    const target = this.clock.nowMs() + milliseconds;
    for (let due = this.timeline.nextAt(); due !== undefined && due <= target; due = this.timeline.nextAt()) {
      this.clock.advance(Math.max(0, due - this.clock.nowMs()));
      this.runDue(due);
    }
    this.clock.advance(target - this.clock.nowMs());
  }

  /** The next few scheduled entries, for status displays. */
  upcoming(limit = 5): TimelineEntry[] {
    return this.timeline.upcoming(limit);
  }

  private runDue(nowMs: number): void {
    for (const { entry, position } of this.timeline.takeDue(nowMs)) {
      const random = new SeededRandom(this.options.seed * 7919 + 1000 + position);
      const context = { state: this.state(entry.vendor), world: this.world, random, nowIso: this.clock.nowIso() };
      for (const event of this.scenarioAction(entry).run(entry.params, context)) this.record(event, "scenario");
    }
  }

  private scenarioAction(entry: TimelineEntry) {
    const actions = this.vendor(entry.vendor).scenarioActions ?? {};
    const action = actions[entry.action];
    if (!action) {
      const available = Object.keys(actions).join(", ") || "none";
      throw new Error(`${entry.vendor} has no scenario action "${entry.action}". Available: ${available}`);
    }
    return action;
  }

  /** Back to the seeded starting world. Same seed and options give a byte-identical log. */
  reset(): void {
    const { seed, startTime, worldSize, drift } = this.options;
    this.clock = new TwinClock(startTime);
    this.log = new EventLog();
    this.world = generateWorld(new SeededRandom(seed), { startTime, size: worldSize, drift });
    this.faultRandom = new SeededRandom(seed + 1);
    this.faultRules = [];
    this.checkpoints.clear();
    this.bookkeeping.clearRateLimits();
    this.states = new Map([...this.vendors.values()].map((v) => [v.name, v.createState()]));

    for (const vendor of this.vendors.values()) {
      for (const event of vendor.seed(this.world)) this.record(event, "seed");
    }
    this.timeline.rearmAfter(Number.NEGATIVE_INFINITY);
    this.runDue(this.clock.nowMs());
  }

  /** A vendor's OAuth server, created on first use with the vendor's documented policy. */
  oauthServer(vendor: VendorName, policy: OAuthPolicy): OAuthServer {
    return this.bookkeeping.oauthServer(vendor, policy);
  }

  /** The rate-limit budget for a key (e.g. one vendor app), created full on first use. */
  rateLimitBucket(key: string, limits: BucketLimits): LeakyBucket {
    return this.bookkeeping.rateLimitBucket(key, limits);
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
    this.bookkeeping.clearRateLimits();
    this.timeline.rearmAfter(this.clock.nowMs());

    // Checkpoints taken after this one point at history that no longer exists.
    for (const [otherName, other] of this.checkpoints) {
      if (other.seq > checkpoint.seq) this.checkpoints.delete(otherName);
    }
  }
}
