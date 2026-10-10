/**
 * QuickBooks transaction dates (TxnDate, DueDate) are plain dates, YYYY-MM-DD in every documented sample.
 * The Invoice reference also calls yyyy/MM/dd valid, so both are accepted and stored as YYYY-MM-DD.
 * https://developer.intuit.com/app/developer/qbo/docs/api/accounting/all-entities/invoice (TxnDate)
 */

/** The date as YYYY-MM-DD, or undefined if it isn't a real date. */
export function qboDate(value: unknown): string | undefined {
  const match = typeof value === "string" ? /^(\d{4})[-/](\d{2})[-/](\d{2})$/.exec(value) : null;
  if (!match) return undefined;
  const iso = `${match[1]}-${match[2]}-${match[3]}`;
  const parsed = new Date(`${iso}T00:00:00Z`);
  // Rejects impossible dates like 2026-02-30, which would otherwise roll over into March.
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().startsWith(iso) ? iso : undefined;
}

/** "If the date is not supplied, the current date on the server is used": today, in twin time. */
export function qboToday(nowIso: string): string {
  return nowIso.slice(0, 10);
}

/**
 * A date-time a client sent, in any of the documented forms ("2015-11-28", "2011-08-10T10:20:30-0700",
 * "2026-07-13T11:00:00.000Z"), as milliseconds since the epoch; undefined if it isn't one.
 *
 * The docs don't say which time zone a value without an offset is in, so the twin reads it as UTC (FIDELITY.md
 * marks this "check"). Never hand such a value to Date.parse: it would use the host's own time zone, and the
 * twin's answers would depend on the machine it runs on.
 */
export function qboDateTimeMs(value: string): number | undefined {
  const match = /^(\d{4}-\d{2}-\d{2})(?:T(\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?)([Zz]|[+-]\d{2}:?\d{2})?)?$/.exec(value.trim());
  if (!match?.[1] || !qboDate(match[1])) return undefined;
  const [, date, time = "00:00", zone = "Z"] = match;
  const ms = Date.parse(`${date}T${time}${zone.replace(/^([+-]\d{2})(\d{2})$/, "$1:$2").toUpperCase()}`);
  return Number.isNaN(ms) ? undefined : ms;
}
