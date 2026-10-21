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
    this.webhooks.notice(recorded, vendor, this.state(event.vendor), this.clock.nowMs()); // not while history is replayed: quietly()
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
   * Switch to a scenario: a different seed, start time, world size, or faults, and its timeline, made from the new
   * world (whose business hours a timeline's local times are in), with the entries already due applied. All or
   * nothing: if the new options can't make a world, or an entry due at the start throws, the twin is left as it was.
   */
  load(changes: Partial<Omit<TwinOptions, "vendors">>, timeline: (world: World) => TimelineEntry[]): void {
    const options = { ...this.options, ...changes };
    const start = startingPoint(options);
    const entries = timeline(start.world);
    this.startOver(() => {
      this.options = options;
      this.timeline.schedule(entries);
      this.rebuild(start);
    });
  }

  /** Move twin time forward, applying scheduled entries at their own times on the way. */
  advance(milliseconds: number): void {
    this.timeline.advanceTo(this.clock.nowMs() + milliseconds);
  }

  /** The next few scheduled entries, for status displays. */
  upcoming(limit = 5): TimelineEntry[] {
    return this.timeline.upcoming(limit);
  }

  /**
   * Back to the seeded starting world, with the loaded scenario's faults: the same seed and options give a byte-identical
   * log. All or nothing, like load().
   */
  reset(): void {
    this.startOver(() => this.rebuild(startingPoint(this.options)));
  }

  /**
   * Replace the twin's history by `rebuild`, all or nothing: if it throws, everything it replaced is put back. Once it
   * works, rate-limit budgets start full and pending deliveries are dropped, as bookkeeping about the history it replaced.
   */
  private startOver(rebuild: () => void): void {
    const { options, clock, log, world, faultRules, faultRandom, states, checkpoints } = this;
    const restoreTimeline = this.timeline.save();
    try {
      rebuild();
    } catch (error) {
      Object.assign(this, { options, clock, log, world, faultRules, faultRandom, states, checkpoints });
      restoreTimeline();
      throw error;
    }
    this.bookkeeping.clearRateLimits();
    this.webhooks.dropPending();
  }

  private rebuild({ clock, world }: { clock: TwinClock; world: World }): void {
    this.restart(clock, streams.faults(this.options.seed), []);
    this.world = world;
    this.faultRules = this.options.faults ?? [];
    this.checkpoints = new Checkpoints(); // a new one, so a rebuild that fails can put the old one back
    // The seeded world, then the scheduled entries already due: history, not news, so none of it sends a webhook.
    this.webhooks.quietly(() => {
      for (const vendor of this.vendors.values()) {
        for (const event of vendor.seed(this.world)) this.record(event, "seed");
      }
      this.timeline.rearmAfter(Number.NEGATIVE_INFINITY);
      this.timeline.runDue(this.clock.nowMs());
    });
  }

  /** Start over from `history`, replayed rather than recorded, at `clock`: what a reset and a rewind share. */
  private restart(clock: TwinClock, faultRandom: FaultRandom, history: readonly TwinEvent[]): void {
    this.clock = clock;
    this.faultRandom = faultRandom;
    this.log = new EventLog();
    this.states = new Map([...this.vendors.values()].map((v) => [v.name, v.createState()]));
    for (const event of history) this.vendor(event.vendor).apply(this.state(event.vendor), this.log.append(event));
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
    this.startOver(() => {
      this.restart(new TwinClock(checkpoint.time), faultRandom, this.log.all().slice(0, checkpoint.seq));
      this.timeline.rearmAfter(this.clock.nowMs());
    });
    this.checkpoints.forgetAfter(checkpoint.seq);
  }
}
