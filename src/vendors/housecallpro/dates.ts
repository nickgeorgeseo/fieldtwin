/**
 * A date or date-time a client sent ("2026-07-13", "2026-07-13T15:30:00", with or without "Z" or an offset), as
 * milliseconds since the epoch; undefined if it isn't one. The docs write times as "ISO-8601 formatted date string in
 * UTC YYYY-MM-DDTHH:MM:SS", so a time without an offset is UTC. Never hand such a value to Date.parse: it would use the
 * host's own time zone, and the twin's answers would depend on the machine it runs on.
 */
export function readTime(value: string): number | undefined {
  const match = /^(\d{4}-\d{2}-\d{2})(?:T(\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?)([Zz]|[+-]\d{2}:?\d{2})?)?$/.exec(value.trim());
  if (!match?.[1]) return undefined;
  const [, date, time = "00:00", zone = "Z"] = match;
  // Rejects impossible dates like 2026-02-30, which would otherwise roll over into March.
  if (Number.isNaN(Date.parse(`${date}T00:00:00Z`)) || !new Date(`${date}T00:00:00Z`).toISOString().startsWith(date)) return undefined;
  const ms = Date.parse(`${date}T${time}${zone.replace(/^([+-]\d{2})(\d{2})$/, "$1:$2").toUpperCase()}`);
  return Number.isNaN(ms) ? undefined : ms;
}
