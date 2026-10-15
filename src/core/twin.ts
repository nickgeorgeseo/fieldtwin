import type { World } from "../world/generate-world.ts";
import { Bookkeeping } from "./bookkeeping.ts";
import { Checkpoints } from "./checkpoints.ts";
import { TwinClock } from "./clock.ts";
import { EventLog } from "./event-log.ts";
import type { OAuthPolicy, OAuthServer } from "./oauth.ts";
import { copyFaultRandom, type FaultRandom, streams } from "./streams.ts";
import { Timeline, type TimelineEntry } from "./timeline.ts";
import { startingPoint, type TwinOptions } from "./twin-options.ts";
import type { AuthMode, Checkpoint, EventSource, FaultRule, NewEvent, TwinEvent, VendorName } from "./types.ts";
import type { VendorTwin } from "./vendor-twin.ts";
import { WebhookDispatcher } from "./webhook-dispatcher.ts";

/**
 * The running twin: one fake business, seen through several vendor APIs.
 *
 * Three rules keep this easy to reason about:
 *   1. All state changes go through record(). Nothing else writes vendor state.
 *   2. All time comes from this.clock. All randomness comes from a SeededRandom, made in streams.ts.
 *   3. Vendor state can always be rebuilt by replaying the event log.
 */
export class Twin {
  clock!: TwinClock;
  log!: EventLog;
  world!: World;
  faultRules: FaultRule[] = [];
  authMode: AuthMode;
  readonly defaultAuthMode: AuthMode; // what the twin started with (FIELDTWIN_AUTH); a scenario without `auth` returns to it
  faultRandom!: FaultRandom; // see streams.ts

  private readonly vendors = new Map<VendorName, VendorTwin>();
  private states = new Map<VendorName, unknown>();
  private checkpoints = new Checkpoints<FaultRandom>(); // each saves where the fault dice were, to roll the same again

  // Rate-limit budgets and OAuth grants: request bookkeeping, outside the event log. See bookkeeping.ts.
  private readonly bookkeeping = new Bookkeeping((vendor) => streams.oauth(this.options.seed, [...this.vendors.keys()].indexOf(vendor)));

  // A loaded scenario's schedule, run as advance() moves the clock. See timeline.ts.
  private readonly timeline = new Timeline(this);

  // Webhook subscriptions and deliveries: bookkeeping too. See webhooks.ts and webhook-dispatcher.ts.
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
    if (!this.rebuilding) this.webhooks.notice(recorded, vendor, this.state(event.vendor), this.clock.nowMs());
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
    const start = startingPoint(options);
    this.options = options;
    this.timeline.schedule([]); // the old scenario's schedule doesn't belong in the new world
    this.rebuild(start);
  }

  /** Schedule a scenario's timeline, replacing any other, and apply the entries already due. */
  schedule(entries: TimelineEntry[]): void {
    this.timeline.schedule(entries);
    this.catchUp();
  }

  /** Move twin time forward, applying scheduled entries at their own times on the way. */
  advance(milliseconds: number): void {
    this.timeline.advanceTo(this.clock.nowMs() + milliseconds);
  }

  /** The next few scheduled entries, for status displays. */
  upcoming(limit = 5): TimelineEntry[] {
    return this.timeline.upcoming(limit);
  }

  /** Back to the seeded starting world, with the loaded scenario's faults. Same seed and options give a byte-identical log. */
  reset(): void {
    this.rebuild(startingPoint(this.options));
  }

  private rebuild({ clock, world }: { clock: TwinClock; world: World }): void {
    this.restart(clock, streams.faults(this.options.seed), []);
    this.world = world;
    this.faultRules = this.options.faults ?? [];
    this.checkpoints.clear();
    this.asHistory(() => {
      for (const vendor of this.vendors.values()) {
        for (const event of vendor.seed(this.world)) this.record(event, "seed");
      }
    });
    this.timeline.rearmAfter(Number.NEGATIVE_INFINITY);
    this.catchUp();
  }

  /**
   * Start over from `history`, replayed rather than recorded, at `clock`: what a reset and a rewind share. Rate-limit
   * budgets start full and pending deliveries are dropped, since they are bookkeeping about requests.
   */
  private restart(clock: TwinClock, faultRandom: FaultRandom, history: readonly TwinEvent[]): void {
    this.clock = clock;
    this.faultRandom = faultRandom;
    this.log = new EventLog();
    this.states = new Map([...this.vendors.values()].map((v) => [v.name, v.createState()]));
    for (const event of history) this.vendor(event.vendor).apply(this.state(event.vendor), this.log.append(event));
    this.bookkeeping.clearRateLimits();
    this.webhooks.dropPending();
  }

  /** Apply the scheduled entries already due. They are history, not news, so they send no webhooks. */
  private catchUp(): void {
    this.asHistory(() => this.timeline.runDue(this.clock.nowMs()));
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
    return this.checkpoints.take(name, this.log.length, this.clock.nowIso(), copyFaultRandom(this.faultRandom));
  }

  checkpointList(): Checkpoint[] {
    return this.checkpoints.all();
  }

  /** Everything recorded since a checkpoint (and after event `seq`, if later). The answer to "what did my agent just do?" */
  changesSince(name: string, seq = 0): TwinEvent[] {
    return this.log.after(Math.max(this.checkpoints.get(name).seq, seq));
  }

  /** Go back to a checkpoint by replaying the log up to that point. The same requests then meet the same faults. */
  rewind(name: string): void {
    const checkpoint = this.checkpoints.get(name);
    const faultRandom = copyFaultRandom(this.checkpoints.saved(name)); // a copy, so rewinding there again rolls the same once more
    this.restart(new TwinClock(checkpoint.time), faultRandom, this.log.all().slice(0, checkpoint.seq));
    this.timeline.rearmAfter(this.clock.nowMs());
    this.checkpoints.forgetAfter(checkpoint.seq);
  }
}
