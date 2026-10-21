/**
 * "2026-07-16T16:31:31-06:00": a moment as the business's local time with its UTC offset, the way vendors write
 * times for a company (Jobber's webhook samples). The offset is the world's fixed one, without daylight saving
 * (world/word-lists.ts). Housecall Pro writes its local times in the city's own zone instead (its dates.ts).
 */
export function localTime(ms: number, utcOffsetHours: number): string {
  const offsetMinutes = Math.round(utcOffsetHours * 60);
  const local = new Date(ms + offsetMinutes * 60_000).toISOString().slice(0, 19);
  const sign = offsetMinutes < 0 ? "-" : "+";
  const hours = String(Math.floor(Math.abs(offsetMinutes) / 60)).padStart(2, "0");
  return `${local}${sign}${hours}:${String(Math.abs(offsetMinutes) % 60).padStart(2, "0")}`;
}
