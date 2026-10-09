import type { VendorName } from "./types.ts";

/**
 * A scenario's schedule: things that happen at set twin times ("at 09:00, 15 new Jobber clients").
 *
 * The Twin runs each entry when its clock reaches the entry's time, recording the vendor's events with
 * source "scenario". The schedule only remembers which entry is next: after a rewind, every entry later
 * than the checkpoint is due again, and entries at or before it already happened in the kept history.
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

  /** Replace the schedule. Entries run in time order; entries at the same time run in the order given. */
  schedule(entries: TimelineEntry[]): void {
    this.entries = entries
      .map((entry, index) => ({ entry, index }))
      .sort((a, b) => a.entry.atMs - b.entry.atMs || a.index - b.index)
      .map(({ entry }) => entry);
    this.next = 0;
  }

  /** When the next entry is due, if there is one. */
  nextAt(): number | undefined {
    return this.entries[this.next]?.atMs;
  }

  /** The entries due at or before `ms` that haven't run yet, each with its position in the schedule. */
  takeDue(ms: number): { entry: TimelineEntry; position: number }[] {
    const due: { entry: TimelineEntry; position: number }[] = [];
    while (this.next < this.entries.length && this.entries[this.next]!.atMs <= ms) {
      due.push({ entry: this.entries[this.next]!, position: this.next });
      this.next++;
    }
    return due;
  }

  /** Make every entry after `ms` due again (after a rewind), or every entry (after a reset). */
  rearmAfter(ms: number): void {
    const index = this.entries.findIndex((entry) => entry.atMs > ms);
    this.next = index === -1 ? this.entries.length : index;
  }

  upcoming(limit: number): TimelineEntry[] {
    return this.entries.slice(this.next, this.next + limit);
  }
}
