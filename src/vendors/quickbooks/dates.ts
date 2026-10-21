import { isRealDate } from "../../core/clock.ts";

/**
 * QuickBooks transaction dates (TxnDate, DueDate) are plain dates, YYYY-MM-DD in every documented sample.
 * The Invoice reference also calls yyyy/MM/dd valid, so both are accepted and stored as YYYY-MM-DD.
 * https://developer.intuit.com/app/developer/qbo/docs/api/accounting/all-entities/invoice (TxnDate)
 *
 * Date-times a client sends (CDC's changedSince, MetaData times in a query), in any of the documented forms, are read
 * by core's readUtcTime. The docs don't say which time zone one without an offset is in, so the twin reads it as UTC
 * (FIDELITY.md marks this "check").
 */

/** The date as YYYY-MM-DD, or undefined if it isn't a real date. */
export function qboDate(value: unknown): string | undefined {
  const match = typeof value === "string" ? /^(\d{4})[-/](\d{2})[-/](\d{2})$/.exec(value) : null;
  if (!match) return undefined;
  const iso = `${match[1]}-${match[2]}-${match[3]}`;
  return isRealDate(iso) ? iso : undefined;
}

/**
 * "If the date is not supplied, the current date on the server is used": today in twin time, at the company. A
 * company keeps its books in its own time zone, so at 8 p.m. in Texas it is still today there, though tomorrow in UTC.
 */
export function qboToday(nowMs: number, utcOffsetHours: number): string {
  return new Date(nowMs + utcOffsetHours * 3_600_000).toISOString().slice(0, 10);
}
