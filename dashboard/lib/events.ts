import type { TwinEvent } from "./twin-types.ts";

/**
 * The event log (GET /_twin/log.jsonl): everything that ever happened in the twin, one JSON event per line. Each
 * event carries the whole record it is about, so the feed can say what it was without asking the vendor APIs.
 */

export function parseLog(text: string): TwinEvent[] {
  return text
    .split("\n")
    .filter((line) => line.trim())
    .map((line) => JSON.parse(line) as TwinEvent);
}

type Fields = Record<string, unknown>;

/** A short label for the record an event is about: 'Id=26 "Dana Whitfield"', '#13 "AC tune-up"'. */
export function describeEvent(event: TwinEvent): string {
  const record = recordOf(event.data);
  if (!record) return "";
  const parts = [
    text(record.Id) && `Id=${text(record.Id)}`,
    text(record.DocNumber) && `DocNumber=${text(record.DocNumber)}`,
    number(record) && `#${number(record)}`,
    name(record) && `"${name(record)}"`,
    typeof record.TotalAmt === "number" && record.TotalAmt.toFixed(2),
  ];
  return parts.filter(Boolean).join(" ");
}

export interface EventFilter {
  vendor: string; // "" for every vendor
  sources: string[];
  search: string;
}

export function filterEvents(events: TwinEvent[], { vendor, sources, search }: EventFilter): TwinEvent[] {
  const wanted = search.trim().toLowerCase();
  return events.filter(
    (event) =>
      (!vendor || event.vendor === vendor) &&
      sources.includes(event.source) &&
      (!wanted || `${event.type} ${JSON.stringify(event.data)}`.toLowerCase().includes(wanted)),
  );
}

/** The record in `{ "customer": {...} }`: events name what they carry by its kind. */
function recordOf(data: unknown): Fields | null {
  if (typeof data !== "object" || data === null) return null;
  const values = Object.values(data);
  const [only] = values;
  return values.length >= 1 && typeof only === "object" && only !== null && !Array.isArray(only) ? (only as Fields) : null;
}

function name(record: Fields): string {
  const person = [text(record.firstName), text(record.lastName)].filter(Boolean).join(" ");
  const customer = text(field(record.CustomerRef, "name"));
  const named = text(record.name) || text(field(record.name, "full")); // a Jobber account's name, a team member's full name
  return (
    text(record.DisplayName) ||
    text(record.Name) ||
    person ||
    text(record.companyName) ||
    named ||
    text(record.subject) ||
    text(record.title) ||
    customer
  );
}

function number(record: Fields): string {
  return text(record.invoiceNumber) || text(record.jobNumber) || text(record.quoteNumber);
}

function field(value: unknown, key: string): unknown {
  return typeof value === "object" && value !== null ? (value as Fields)[key] : undefined;
}

function text(value: unknown): string {
  return typeof value === "string" || typeof value === "number" ? String(value) : "";
}
