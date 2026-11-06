/**
 * The twin describes each event in one line (src/control/operations.ts, summarize):
 *
 *   2026-07-13T11:00:00.000Z  quickbooks  CustomerCreated Id=26 "Dana Whitfield" SyncToken=0  (api)
 *
 * The dashboard shows the time, vendor, and source in columns of their own, so it takes the line apart.
 */

export interface SummaryParts {
  at: string | null;
  vendor: string | null;
  what: string;
  source: string | null;
}

// The s flag: the one line can hold a line break after all, inside a name a vendor took as written.
const SUMMARY = /^(\S+) {2}(\S+) {2}(.*) {2}\((\w+)\)$/s;

export function summaryParts(summary: string): SummaryParts {
  const match = SUMMARY.exec(summary);
  if (!match) return { at: null, vendor: null, what: summary, source: null };
  const [, at = null, vendor = null, what = summary, source = null] = match;
  return { at, vendor, what, source };
}
