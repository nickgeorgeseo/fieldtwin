import { hcpLinesCents } from "./hcp-amounts.ts";
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

/** A short label for the record an event is about: 'Id=26 "Dana Whitfield"', '#13 "AC tune-up"', '#12 131.25'. */
export function describeEvent(event: TwinEvent): string {
  const record = recordOf(event.data);
  if (!record) return "";
  const parts = [
    text(record.Id) && `Id=${text(record.Id)}`,
    text(record.DocNumber) && `DocNumber=${text(record.DocNumber)}`,
    number(record) && `#${number(record)}`,
    name(record) && `"${name(record)}"`,
    amount(record),
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

/** The record in `{ "customer": {...} }`: events name what they carry by its kind, after an id or two at most. */
function recordOf(data: unknown): Fields | null {
  if (typeof data !== "object" || data === null) return null;
  const record = Object.values(data).find((value) => typeof value === "object" && value !== null && !Array.isArray(value));
  return (record as Fields | undefined) ?? null;
}

function name(record: Fields): string {
  const person =
    [text(record.firstName), text(record.lastName)].filter(Boolean).join(" ") ||
    [text(record.first_name), text(record.last_name)].filter(Boolean).join(" "); // Housecall Pro's names are snake_case
  const customer = text(field(record.CustomerRef, "name"));
  const named = text(record.name) || text(field(record.name, "full")); // a Jobber account's name, a team member's full name
  const place = [text(record.street), text(record.city)].filter(Boolean).join(", "); // a Housecall Pro address
  // A Housecall Pro customer needs only one of these, and goes by the first it has.
  const contact = text(record.email) || text(record.mobile_number) || text(record.home_number) || text(record.work_number);
  return (
    text(record.DisplayName) ||
    text(record.Name) ||
    person ||
    text(record.companyName) ||
    text(record.company) ||
    named ||
    text(record.subject) ||
    text(record.title) ||
    text(record.description) ||
    place ||
    customer ||
    contact
  );
}

function number(record: Fields): string {
  return (
    text(record.invoiceNumber) ||
    text(record.jobNumber) ||
    text(record.quoteNumber) ||
    text(record.invoice_number) ||
    text(record.estimate_number)
  );
}

/** What an invoice comes to, in dollars, or each of a Housecall Pro estimate's options. Housecall Pro counts in cents. */
function amount(record: Fields): string {
  if (typeof record.TotalAmt === "number") return record.TotalAmt.toFixed(2);
  const options = Array.isArray(record.options) ? record.options.map((option) => field(option, "line_items")) : [];
  const lineLists = Array.isArray(record.items) ? [record.items] : options;
  return lineLists
    .filter(Array.isArray)
    .map(centsOf)
    .filter(Number.isFinite) // lines without a price say nothing
    .map((cents) => (cents / 100).toFixed(2))
    .join(" or ");
}

/** Housecall Pro's lines, in cents, whatever an event's lines hold. */
function centsOf(lines: unknown[]): number {
  return hcpLinesCents(lines.map((line) => ({ quantity: Number(field(line, "quantity")), unit_price: Number(field(line, "unit_price")) })));
}

function field(value: unknown, key: string): unknown {
  return typeof value === "object" && value !== null ? (value as Fields)[key] : undefined;
}

function text(value: unknown): string {
  return typeof value === "string" || typeof value === "number" ? String(value) : "";
}
