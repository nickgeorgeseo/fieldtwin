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

/**
 * "2026-12-14T23:30:00-06:00": a moment as clocks in an IANA time zone show it, with the offset the zone has at that
 * moment, daylight saving included. That is how `scheduled_start_local` is documented: "scheduled_start expressed in
 * time_zone, as an ISO-8601 timestamp with a UTC offset". Intl reads the zone's rules from Node's own time zone data,
 * never from the host's setting, so every machine gives the same answer.
 */
export function zonedTime(ms: number, timeZone: string): string {
  const parts = Object.fromEntries(
    formatter(timeZone)
      .formatToParts(new Date(ms))
      .map((part) => [part.type, part.value]),
  );
  const offset = parts.timeZoneName === "GMT" ? "+00:00" : parts.timeZoneName!.slice("GMT".length);
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}:${parts.second}${offset}`;
}

const formatters = new Map<string, Intl.DateTimeFormat>();

function formatter(timeZone: string): Intl.DateTimeFormat {
  let made = formatters.get(timeZone);
  if (!made) {
    const fields = { year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" } as const;
    made = new Intl.DateTimeFormat("en-US", { ...fields, timeZone, hourCycle: "h23", timeZoneName: "longOffset" });
    formatters.set(timeZone, made);
  }
  return made;
}
