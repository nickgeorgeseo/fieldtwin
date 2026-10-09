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
