/**
 * Twin time is a moment the twin chose, never this computer's clock. The dashboard shows it in the company's own
 * time zone (GET /_twin's company.utcOffsetHours), the way someone working there would read it.
 */

const DAY = new Intl.DateTimeFormat("en-US", { timeZone: "UTC", weekday: "short", month: "short", day: "numeric", year: "numeric" });
const TIME = new Intl.DateTimeFormat("en-US", { timeZone: "UTC", hour: "numeric", minute: "2-digit" });

export interface TwinTimeParts {
  day: string; // "Mon, Jul 13, 2026"
  time: string; // "6:00 AM"
  zone: string; // "UTC−5"
}

export function formatTwinTime(iso: string, utcOffsetHours: number): TwinTimeParts {
  const local = new Date(Date.parse(iso) + utcOffsetHours * 3_600_000);
  return { day: DAY.format(local), time: TIME.format(local).replace(/ /g, " "), zone: zoneName(utcOffsetHours) };
}

function zoneName(utcOffsetHours: number): string {
  if (utcOffsetHours === 0) return "UTC";
  const hours = Math.trunc(Math.abs(utcOffsetHours));
  const minutes = Math.round((Math.abs(utcOffsetHours) - hours) * 60);
  return `UTC${utcOffsetHours < 0 ? "−" : "+"}${hours}${minutes ? `:${String(minutes).padStart(2, "0")}` : ""}`;
}

/** "1 hour" for 60, "90 minutes" for 90: a jump of the clock as people say it. */
export function minutesLabel(minutes: number): string {
  const [amount, unit] = minutes % 1440 === 0 ? [minutes / 1440, "day"] : minutes % 60 === 0 ? [minutes / 60, "hour"] : [minutes, "minute"];
  return `${amount} ${unit}${amount === 1 ? "" : "s"}`;
}
