import { createHash } from "node:crypto";
import type { TwinEvent } from "./types.ts";

/**
 * The append-only history of everything that happened in the twin.
 *
 * This is the single source of truth. Vendor state is just this log, replayed.
 * Because it is plain JSON, you can open an exported log in any editor and read it.
 */
export class EventLog {
  private events: TwinEvent[] = [];
  // fingerprints[n] is of the first n events: a hash of fingerprints[n - 1] and event n. Made only when a reader asks
  // for a position, so recording, and replaying a whole history on rewind, never waits for hashing.
  private fingerprints = [EMPTY_FINGERPRINT];

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

  /**
   * Where the log ends, or where event `seq` is: the seq and a fingerprint of everything up to it, like
   * "282-5f0c3a9e81d27b46". The same history always has the same positions, and another history (after a reset or a
   * rewind, or in a twin started again) has other ones, so a reader that kept a position can tell if it still holds.
   */
  position(seq = this.length): string {
    for (let n = this.fingerprints.length; n <= seq; n++) {
      this.fingerprints.push(fingerprint(this.fingerprints[n - 1]!, this.events[n - 1]!));
    }
    return `${seq}-${this.fingerprints[seq]}`;
  }

  /**
   * The events after a position an earlier read gave, or after an event's seq (taken on trust). Throws LogChangedError
   * when the log isn't the history that position is in any more.
   */
  afterPosition(position: string): TwinEvent[] {
    const match = /^(\d+)(-[0-9a-f]{16})?$/.exec(position);
    if (!match) {
      throw new Error(
        `"${position}" isn't a position in the log. Use the X-Twin-Log-Position header of an earlier read, like "282-5f0c3a9e81d27b46", or an event's seq.`,
      );
    }
    const seq = Number(match[1]);
    if (seq > this.length || (match[2] !== undefined && this.position(seq) !== position)) {
      throw new LogChangedError(
        `The log has changed since ${position}: the twin was reset, rewound to before it, or started again, or a scenario was loaded. Read it again from the start.`,
      );
    }
    return this.after(seq);
  }
}

/** A reader's position is in a history the log no longer holds, so what it read is out of date: it starts over. */
export class LogChangedError extends Error {}

const EMPTY_FINGERPRINT = "0000000000000000";

function fingerprint(before: string, event: TwinEvent): string {
  return createHash("sha256").update(before).update(JSON.stringify(event)).digest("hex").slice(0, 16);
}
