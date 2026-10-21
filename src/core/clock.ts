/** How to write a moment so it means the same one on every machine. */
export const TWIN_TIME_FORM = 'Write a date, a time, and a UTC offset, like "2026-07-13T08:00:00-05:00" or "2026-07-13T13:00:00Z".';

/**
 * An ISO 8601 time with a UTC offset, in epoch milliseconds; undefined for anything else. A time without an offset is
 * refused: Date.parse would read it in the host's time zone, and the same scenario would start at a different
 * moment on every machine.
 */
export function parseTwinTime(text: string): number | undefined {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?([Zz]|[+-]\d{2}:\d{2})$/.test(text)) return undefined;
  const ms = Date.parse(text);
  return Number.isNaN(ms) ? undefined : ms;
}

/**
 * A date or date-time a client sent ("2026-07-13", "2026-07-13T15:30:00", "2011-08-10T10:20:30-0700",
 * "2026-07-13T11:00:00.000Z"), in epoch milliseconds; undefined if it isn't one. A time without an offset is read
 * as UTC, as the vendors write their own times (each vendor's FIDELITY.md rows say where that is a guess). Never hand
 * such a value to Date.parse: it would use the host's time zone, and answers would depend on the machine.
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

  now(): Date {
    return new Date(this.currentMs);
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
