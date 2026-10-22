import { streams } from "./streams.ts";
import type { Twin } from "./twin.ts";
import type { NewEvent, VendorName } from "./types.ts";
import { scenarioActionOf } from "./vendor-twin.ts";

/**
 * A scenario's schedule: things that happen at set twin times ("at 09:00, 15 new Jobber clients").
 *
 * twin.advance() stops the clock at each entry's time and runs it then, recording the vendor's events with source
 * "scenario". The schedule only remembers which entry is next: after a rewind, every entry later than the
 * checkpoint is due again, and entries at or before it already happened in the kept history.
 */
export interface TimelineEntry {
  atMs: number;
  vendor: VendorName;
  action: string; // one of the vendor's scenarioActions
  params: unknown;
}

export class Timeline {
  private entries: TimelineEntry[] = [];
  private next = 0;

  constructor(private readonly twin: Twin) {}

  /**
   * Replace the schedule. Every entry's parameters are checked first, so a bad one changes nothing. Entries run in
   * time order; entries at the same time run in the order given.
   */
  schedule(entries: TimelineEntry[]): void {
    for (const entry of entries) scenarioActionOf(this.twin.vendor(entry.vendor), entry.action).check(entry.params);
    this.entries = entries
      .map((entry, index) => ({ entry, index }))
      .sort((a, b) => a.entry.atMs - b.entry.atMs || a.index - b.index)
      .map(({ entry }) => entry);
    this.next = 0;
  }

  /** Move the twin's clock to `targetMs`, stopping at each entry due on the way to run it at its own time. */
  advanceTo(targetMs: number): void {
    for (let due = this.nextAt(); due !== undefined && due <= targetMs; due = this.nextAt()) {
      this.twin.clock.advance(Math.max(0, due - this.twin.clock.nowMs()));
      this.runDue(due, "the clock stopped there, with it still due"); // the caller gets what happened on the way
    }
    this.twin.clock.advance(targetMs - this.twin.clock.nowMs());
  }

  /**
   * Run the entries due at or before `ms` that haven't run yet. One whose action throws has recorded nothing and stays
   * due, so the schedule never moves on past something that didn't happen. Its ScenarioEntryError names it, followed
   * by `ifItFails`, what its failing means for the caller: advanceTo() says the clock stopped there; a twin rebuild
   * (load or reset) says nothing, since the twin is put back as it was and the error speaks for itself.
   */
  runDue(ms: number, ifItFails?: string): void {
    while (this.next < this.entries.length && this.entries[this.next]!.atMs <= ms) {
      const events = this.run(this.entries[this.next]!, this.next, ifItFails);
      this.next++;
      for (const event of events) this.twin.record(event, "scenario");
    }
  }

  private run(entry: TimelineEntry, position: number, ifItFails?: string): NewEvent[] {
    const { twin } = this;
    const random = streams.timelineEntry(twin.seed, position);
    const context = { state: twin.state(entry.vendor), world: twin.world, random, nowIso: twin.clock.nowIso() };
    try {
      // Anything that throws, not just run(): a vendor whose scenarioActions changed after load no longer has the action.
      return scenarioActionOf(twin.vendor(entry.vendor), entry.action).run(entry.params, context);
    } catch (error) {
      throw new ScenarioEntryError(entry, error, ifItFails);
    }
  }

  /** The schedule as it stands, put back by calling what this returns: for a twin whose rebuild fails partway. */
  save(): () => void {
    const { entries, next } = this;
    return () => {
      this.entries = entries;
      this.next = next;
    };
  }

  /** Make every entry after `ms` due again (after a rewind), or every entry (after a reset). */
  rearmAfter(ms: number): void {
    const index = this.entries.findIndex((entry) => entry.atMs > ms);
    this.next = index === -1 ? this.entries.length : index;
  }

  upcoming(limit: number): TimelineEntry[] {
    return this.entries.slice(this.next, this.next + limit);
  }

  private nextAt(): number | undefined {
    return this.entries[this.next]?.atMs;
  }
}

/**
 * A scheduled entry whose action threw when it ran, though its check passed when the scenario loaded: a bug in the
 * vendor's action, named by its entry ("jobber newClients at 2026-07-13T12:00:00.000Z"), with what threw as its cause.
 */
export class ScenarioEntryError extends Error {
  constructor(entry: TimelineEntry, cause: unknown, ifItFails?: string) {
    const what = `${entry.vendor} ${entry.action} at ${new Date(entry.atMs).toISOString()}`;
    const failed = `${what} failed: ${cause instanceof Error ? cause.message : String(cause)}`;
    super(ifItFails ? `${failed}; ${ifItFails}` : failed, { cause });
  }
}
