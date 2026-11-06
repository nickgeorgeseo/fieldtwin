/** How to write a moment so it means the same one on every machine. */
export const TWIN_TIME_FORM =
  'Write a date from year 0100 on, a time, and a UTC offset, like "2026-07-13T08:00:00-05:00" or "2026-07-13T13:00:00Z".';

/**
 * An ISO 8601 time with a UTC offset, in epoch milliseconds; undefined for anything else. A time without an offset is
 * refused: Date.parse would read it in the host's time zone, and the same scenario would start at a different
 * moment on every machine. So is a day the calendar doesn't have: Date.parse would quietly start 2026-02-30 in March. And
 * so is a year from 0000 to 0099: almost always a typo for this century ("0026"), and a year Date.UTC would read as 1900
 * to 1999.
 */
export function parseTwinTime(text: string): number | undefined {
  if (!/^(?!00)\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?([Zz]|[+-]\d{2}:\d{2})$/.test(text)) return undefined;
  if (!isRealDate(text.slice(0, 10))) return undefined;
  const ms = Date.parse(text);
  return Number.isNaN(ms) ? undefined : ms;
}

/**
 * A date or date-time a client sent ("2026-07-13", "2026-07-13T15:30:00", "2011-08-10T10:20:30-0700",
 * "2026-07-13T11:00:00.000Z"), in epoch milliseconds; undefined if it isn't one. A time without an offset is read
 * as UTC, as the vendors write their own times (where a vendor's docs leave that open, its FIDELITY.md section says
 * so). Never hand such a value to Date.parse: it would use the host's time zone, and answers would depend on the
 * machine.
 */
export function readUtcTime(value: string): number | undefined {
  const match = /^(\d{4}-\d{2}-\d{2})(?:T(\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?)([Zz]|[+-]\d{2}:?\d{2})?)?$/.exec(value.trim());
  if (!match?.[1] || !isRealDate(match[1])) return undefined;
  const [, date, time = "00:00", zone = "Z"] = match;
  const ms = Date.parse(`${date}T${time}${zone.replace(/^([+-]\d{2})(\d{2})$/, "$1:$2").toUpperCase()}`);
  return Number.isNaN(ms) ? undefined : ms;
}

/** Whether YYYY-MM-DD is a day the calendar has: 2026-02-30 isn't, though Date would roll it over into March. */
export function isRealDate(iso: string): boolean {
  const parsed = new Date(`${iso}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().startsWith(iso);
}

/**
 * Twin time.
 *
 * Nothing in this codebase calls Date.now(). Everything asks the clock instead.
 * That is what makes runs reproducible, and it lets a test jump forward an hour instantly.
 */
export class TwinClock {
  private currentMs: number;

  constructor(start: string) {
    const startMs = parseTwinTime(start);
    if (startMs === undefined) throw new Error(`"${start}" isn't a time the twin can start at. ${TWIN_TIME_FORM}`);
    this.currentMs = startMs;
  }

  /**
   * A clock at an exact moment, fractions of a millisecond included: where a checkpoint left it. Read back from the
   * checkpoint's ISO time it could land a millisecond off before 1970, or not parse at all after year 9999.
   */
  static at(ms: number): TwinClock {
    const clock = new TwinClock("1970-01-01T00:00:00Z");
    clock.currentMs = ms;
    return clock;
  }

  /** Floored, since Date drops a fraction toward zero: before 1970 that would read the next millisecond, ahead of the clock. */
  now(): Date {
    return new Date(Math.floor(this.currentMs));
  }

  nowMs(): number {
    return this.currentMs;
  }

  nowIso(): string {
    return this.now().toISOString();
  }

  advance(milliseconds: number): void {
    if (milliseconds < 0) {
      throw new Error("Twin time only moves forward. Rewind to a checkpoint to go back.");
    }
    this.currentMs += milliseconds;
  }
}
