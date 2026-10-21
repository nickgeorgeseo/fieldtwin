/** Housecall Pro's timestamps: UTC ISO 8601 to the second, like the reference's samples ("2026-09-02T14:31:07Z"). */
export function hcpTime(iso: string): string {
  return iso.replace(/\.\d{3}Z$/, "Z");
}

/** The same, for a moment in epoch milliseconds. */
export function hcpTimeAt(ms: number): string {
  return hcpTime(new Date(ms).toISOString());
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
