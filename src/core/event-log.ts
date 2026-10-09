import type { TwinEvent } from "./types.ts";

/**
 * The append-only history of everything that happened in the twin.
 *
 * This is the single source of truth. Vendor state is just this log, replayed.
 * Because it is plain JSON, you can open an exported log in any editor and read it.
 */
export class EventLog {
  private events: TwinEvent[] = [];

  append(event: Omit<TwinEvent, "seq">): TwinEvent {
    const recorded: TwinEvent = { seq: this.events.length + 1, ...event };
    this.events.push(recorded);
    return recorded;
  }

  get length(): number {
    return this.events.length;
  }

  all(): readonly TwinEvent[] {
    return this.events;
  }

  /** Events recorded after the given sequence number. */
  after(seq: number): TwinEvent[] {
    return this.events.slice(seq);
  }

  /** One event per line. Handy for bug reports and diffing two runs. */
  toJsonl(): string {
    return this.events.map((event) => JSON.stringify(event)).join("\n");
  }
}
