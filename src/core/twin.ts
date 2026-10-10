import type { DriftOptions } from "../world/drift.ts";
import { generateWorld, type World, type WorldSize } from "../world/generate-world.ts";
import { Bookkeeping } from "./bookkeeping.ts";
import { Checkpoints } from "./checkpoints.ts";
import { TwinClock } from "./clock.ts";
import { EventLog } from "./event-log.ts";
import type { OAuthPolicy, OAuthServer } from "./oauth.ts";
import { SeededRandom } from "./random.ts";
import { Timeline, type TimelineEntry } from "./timeline.ts";
import type { AuthMode, Checkpoint, EventSource, FaultRule, NewEvent, TwinEvent, VendorName } from "./types.ts";
import { scenarioActionOf, type VendorTwin } from "./vendor-twin.ts";
import { WebhookDispatcher, type WebhookSender } from "./webhooks.ts";

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
 * The dice fault rules roll: one stream for requests, one for webhook deliveries, so subscribing an app (which adds
 * deliveries to roll for) never changes which requests fail. Neither is the world's, so faults never change it.
 */
export interface FaultRandom {
  requests: SeededRandom;
  webhooks: SeededRandom;
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
  readonly defaultAuthMode: AuthMode; // what the twin started with (FIELDTWIN_AUTH); a scenario without `auth` returns to it
  faultRandom!: FaultRandom;

  private readonly vendors = new Map<VendorName, VendorTwin>();
  private states = new Map<VendorName, unknown>();
  private checkpoints = new Checkpoints<FaultRandom>(); // each saves where the fault dice were, to roll the same again

  // Rate-limit budgets and OAuth grants: request bookkeeping, outside the event log. See bookkeeping.ts.
  // Each vendor's OAuth server draws from its own stream, so issuing tokens never changes the world or the faults.
  private readonly bookkeeping = new Bookkeeping(
    (vendor) => new SeededRandom(this.options.seed + 2 + [...this.vendors.keys()].indexOf(vendor)),
  );

  // A loaded scenario's schedule. See schedule() and advance().
  private timeline = new Timeline();

  // Webhook subscriptions and deliveries: bookkeeping too. See core/webhooks.ts.
  readonly webhooks: WebhookDispatcher;
  private rebuilding = false; // while the world or its history is being rebuilt, nothing is news to anyone

  constructor(private options: TwinOptions) {
    for (const vendor of options.vendors) this.vendors.set(vendor.name, vendor);
    this.defaultAuthMode = options.auth ?? "any-token";
    this.authMode = this.defaultAuthMode;
    this.webhooks = new WebhookDispatcher(options.sendWebhook ?? ((url, init) => fetch(url, init)));
    this.reset();
  }

  /** The single write path. Every change to every vendor's state goes through here. */
  record(event: NewEvent, source: EventSource): TwinEvent {
    const recorded = this.log.append({ ...event, at: this.clock.nowIso(), source });
    const vendor = this.vendor(event.vendor);
    vendor.apply(this.state(event.vendor), recorded);
    if (!this.rebuilding) {
      // Webhooks are bookkeeping: a bug there must never turn a write that happened into an error.
      try {
        this.webhooks.notice(recorded, vendor, this.state(event.vendor), this.clock.nowMs());
      } catch (error) {
        console.error(`fieldtwin: couldn't queue webhooks for event ${recorded.seq}: ${(error as Error).stack ?? error}`);
      }
    }
    return recorded;
  }

  /** Send the webhook deliveries that are due by now. Resolves once they have been answered. */
  deliverWebhooks(): Promise<void> {
    return this.webhooks.deliverDue(this.clock.nowMs());
  }

  vendor(name: VendorName): VendorTwin {
    const vendor = this.vendors.get(name);
    if (!vendor) throw new Error(`No vendor twin named "${name}" is loaded`);
    return vendor;
  }

  /** The seed this world was generated from: with the same requests, the same seed gives the same run. */
  get seed(): number {
    return this.options.seed;
  }

  /** The name of the loaded scenario, if any. */
  get scenario(): string | undefined {
    return this.options.scenario;
  }

  vendorNames(): VendorName[] {
    return [...this.vendors.keys()];
  }

  /** Read-only use, please. To change state, record an event. */
  state<State>(name: VendorName): State {
    return this.states.get(name) as State;
  }

  /**
   * Switch to a different seed, start time, or world size, then reset. Used when loading a scenario. If the new
   * options can't make a world (a bad start time, more customers than there are names), this throws before anything
   * changes.
   */
  reconfigure(changes: Partial<Omit<TwinOptions, "vendors">>): void {
    const options = { ...this.options, ...changes };
    const start = this.startOf(options);
    this.options = options;
    this.timeline.schedule([]); // the old scenario's schedule doesn't belong in the new world
    this.rebuild(start);
  }

  /** Schedule a scenario's timeline, replacing any other, and apply the entries already due. */
  schedule(entries: TimelineEntry[]): void {
    for (const entry of entries) scenarioActionOf(this.vendor(entry.vendor), entry.action).check(entry.params);
    this.timeline.schedule(entries);
    this.catchUp();
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
      const action = scenarioActionOf(this.vendor(entry.vendor), entry.action);
      for (const event of action.run(entry.params, context)) this.record(event, "scenario");
    }
  }

  /** Back to the seeded starting world, with the loaded scenario's faults. Same seed and options give a byte-identical log. */
  reset(): void {
    this.rebuild(this.startOf(this.options));
  }

  /** The clock and world a twin with these options starts from. Building them is all that can fail. */
  private startOf({ seed, startTime, worldSize, drift }: TwinOptions): { clock: TwinClock; world: World } {
    return { clock: new TwinClock(startTime), world: generateWorld(new SeededRandom(seed), { startTime, size: worldSize, drift }) };
  }

  private rebuild({ clock, world }: { clock: TwinClock; world: World }): void {
    const { seed } = this.options;
    this.clock = clock;
    this.log = new EventLog();
    this.world = world;
    this.faultRandom = { requests: new SeededRandom(seed + 1), webhooks: new SeededRandom(seed * 7919 + 500) };
    this.faultRules = this.options.faults ?? [];
    this.checkpoints.clear();
    this.bookkeeping.clearRateLimits();
    this.webhooks.dropPending();
    this.states = new Map([...this.vendors.values()].map((v) => [v.name, v.createState()]));

    this.asHistory(() => {
      for (const vendor of this.vendors.values()) {
        for (const event of vendor.seed(this.world)) this.record(event, "seed");
      }
    });
    this.timeline.rearmAfter(Number.NEGATIVE_INFINITY);
    this.catchUp();
  }

  /** Apply the scheduled entries already due. They are history, not news, so they send no webhooks. */
  private catchUp(): void {
    this.asHistory(() => this.runDue(this.clock.nowMs()));
  }

  /** Record history rather than news: nothing recorded meanwhile sends a webhook, even if something throws. */
  private asHistory(record: () => void): void {
    this.rebuilding = true;
    try {
      record();
    } finally {
      this.rebuilding = false;
    }
  }

  /** A vendor's OAuth server, created on first use with the vendor's documented policy. */
  oauthServer(vendor: VendorName, policy: OAuthPolicy): OAuthServer {
    return this.bookkeeping.oauthServer(vendor, policy);
  }

  /** The rate limit kept under a key (e.g. one vendor app), made by `create` on first use. See bookkeeping.ts. */
  rateLimit<Limit>(key: string, create: () => Limit): Limit {
    return this.bookkeeping.rateLimit(key, create);
  }

  checkpoint(name: string): Checkpoint {
    return this.checkpoints.take(name, this.log.length, this.clock.nowIso(), copyOf(this.faultRandom));
  }

  checkpointList(): Checkpoint[] {
    return this.checkpoints.all();
  }

  getCheckpoint(name: string): Checkpoint {
    return this.checkpoints.get(name);
  }

  /** Everything recorded since a checkpoint. The answer to "what did my agent just do?" */
  changesSince(name: string): TwinEvent[] {
    return this.log.after(this.getCheckpoint(name).seq);
  }

  /** Go back to a checkpoint by replaying the log up to that point. The same requests then meet the same faults. */
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
    this.faultRandom = copyOf(this.checkpoints.saved(name)); // a copy, so rewinding there again rolls the same once more
    this.bookkeeping.clearRateLimits();
    this.webhooks.dropPending();
    this.timeline.rearmAfter(this.clock.nowMs());
    this.checkpoints.forgetAfter(checkpoint.seq);
  }
}

function copyOf({ requests, webhooks }: FaultRandom): FaultRandom {
  return { requests: requests.copy(), webhooks: webhooks.copy() };
}
