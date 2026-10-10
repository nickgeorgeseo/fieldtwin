import { streams } from "./streams.ts";
import type { Twin } from "./twin.ts";
import type { VendorName } from "./types.ts";
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
      this.runDue(due);
    }
    this.twin.clock.advance(targetMs - this.twin.clock.nowMs());
  }

  /** Run the entries due at or before `ms` that haven't run yet. */
  runDue(ms: number): void {
    const { twin } = this;
    while (this.next < this.entries.length && this.entries[this.next]!.atMs <= ms) {
      const position = this.next++;
      const entry = this.entries[position]!;
      const random = streams.timelineEntry(twin.seed, position);
      const context = { state: twin.state(entry.vendor), world: twin.world, random, nowIso: twin.clock.nowIso() };
      const action = scenarioActionOf(twin.vendor(entry.vendor), entry.action);
      for (const event of action.run(entry.params, context)) twin.record(event, "scenario");
    }
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
