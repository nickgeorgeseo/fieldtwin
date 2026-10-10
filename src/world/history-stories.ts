import type { SeededRandom } from "../core/random.ts";
import type { CatalogEntry } from "./catalog.ts";
import type { HistoryContext, WorldInvoice, WorldJob, WorldLineItem, WorldQuote, WorldVisit } from "./history.ts";

/**
 * How one piece of work unfolds: the job, its visits, the quote it may have started from, and the invoice
 * it ends with. makeHistory() in history.ts tells these stories and then numbers everything in date order.
 */

/** One job with the quote it came from and the invoice it produced, linked by reference until keys exist. */
export interface JobStory {
  job: WorldJob;
  quote?: WorldQuote;
  invoice?: WorldInvoice;
}

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const BIG_JOB_PRICE = 500; // a service at least this price is quoted first and takes two visits
const NET_DAYS = 30;
const FIRST_START_HOUR = 8; // local time; visits start between 8:00 and 15:30
const LAST_START_HOUR = 15;

export function jobStory(context: HistoryContext, requestedDay: number): JobStory {
  const { random, customers, technicians } = context;
  const lineItems = pickLineItems(context);
  const big = lineItems[0]!.unitPrice >= BIG_JOB_PRICE;

  // Keep every visit wholly in the past or wholly in the future: a big job in the past needs both of its
  // days behind it, and today's schedule only has room for visits that haven't started yet.
  let day = requestedDay;
  if (big && day === -1) day = -2;
  if (day === 0 && localHourNow(context) >= LAST_START_HOUR - 1) day = 1;

  const firstStart = businessHour(context, day, day === 0 ? Math.max(FIRST_START_HOUR, localHourNow(context) + 1) : FIRST_START_HOUR);
  const crew = big && technicians.length > 1 ? pickDistinct(random, technicians, 2) : [random.pick(technicians)];
  const visits: WorldVisit[] = Array.from({ length: big ? 2 : 1 }, (_, index) => {
    const startMs = firstStart + index * DAY;
    const endMs = startMs + random.int(1, 3) * HOUR;
    return {
      key: "",
      startAt: iso(startMs),
      endAt: iso(endMs),
      technicianKeys: crew.map((technician) => technician.key),
      ...(endMs <= context.startMs && { completedAt: iso(endMs) }),
    };
  });

  const job: WorldJob = {
    key: "",
    number: 0,
    customerKey: random.pick(customers).key,
    title: titleFor(lineItems, context),
    createdAt: iso(Math.min(firstStart, context.startMs) - random.int(1, 10) * DAY),
    lineItems,
    visits,
  };
  const quote = big || random.chance(0.15) ? quoteFor(job, context) : undefined;
  return { job, quote, invoice: invoiceFor(job, context) };
}

function pickLineItems(context: HistoryContext): WorldLineItem[] {
  const { random, catalog } = context;
  const service = random.pick(catalog.filter((entry) => entry.kind === "service"));
  const parts = pickDistinct(
    random,
    catalog.filter((entry) => entry.kind === "part"),
    random.int(0, 2),
  );
  const perUnit = /\(per (hour|lb)\)/.test(service.name);
  return [
    lineItem(service, perUnit ? random.int(1, 4) : 1),
    ...parts.map((part) => lineItem(part, part.unitPrice < 50 ? random.int(1, 4) : 1)),
  ];
}

/** The quote a job was converted from: sent a few days before the job, approved just before it. */
function quoteFor(job: WorldJob, context: HistoryContext): WorldQuote {
  const createdMs = Date.parse(job.createdAt) - context.random.int(2, 7) * DAY;
  return {
    key: "",
    number: 0,
    customerKey: job.customerKey,
    title: job.title,
    createdAt: iso(createdMs),
    sentAt: iso(createdMs + HOUR),
    lineItems: job.lineItems,
    approvedAt: iso(Date.parse(job.createdAt) - HOUR),
  };
}

/** A quote sent recently that the customer hasn't answered yet. */
export function openQuote(context: HistoryContext): WorldQuote {
  const { random, customers } = context;
  const lineItems = pickLineItems(context);
  const createdMs = businessHour(context, -random.int(1, 14), 8);
  return {
    key: "",
    number: 0,
    customerKey: random.pick(customers).key,
    title: titleFor(lineItems, context),
    createdAt: iso(createdMs),
    sentAt: iso(createdMs + HOUR),
    lineItems,
  };
}

/** Completed jobs are invoiced within a day or so. Older invoices are more likely to have been paid. */
function invoiceFor(job: WorldJob, context: HistoryContext): WorldInvoice | undefined {
  const { random, startMs } = context;
  const finished = job.visits.at(-1)!.completedAt;
  if (!finished) return undefined;
  const issuedMs = Date.parse(finished) + random.int(1, 26) * HOUR;
  if (issuedMs > startMs) return undefined; // finished too recently: still waiting to be invoiced

  const ageDays = (startMs - issuedMs) / DAY;
  // Most customers pay within the month; a few slip past the due date.
  const paid = random.chance(ageDays > 60 ? 0.95 : ageDays > NET_DAYS ? 0.7 : 0.45);
  const paidMs = issuedMs + Math.floor((random.next() * Math.min(startMs - issuedMs, 40 * DAY)) / 60_000) * 60_000;
  return {
    key: "",
    number: 0,
    customerKey: job.customerKey,
    jobKey: "",
    createdAt: iso(issuedMs),
    issuedAt: iso(issuedMs),
    dueAt: iso(issuedMs + NET_DAYS * DAY),
    lineItems: job.lineItems,
    ...(paid && { paidAt: iso(paidMs) }),
  };
}

/** A time during business hours, `day` days from the start, in the company's time zone. */
function businessHour(context: HistoryContext, day: number, earliestLocalHour: number): number {
  const { random, startMs, utcOffsetHours } = context;
  const localNow = new Date(startMs + utcOffsetHours * HOUR);
  const hour = random.int(Math.min(earliestLocalHour, LAST_START_HOUR), LAST_START_HOUR);
  const minute = random.pick([0, 30]);
  const localMidnight = Date.UTC(localNow.getUTCFullYear(), localNow.getUTCMonth(), localNow.getUTCDate() + day);
  return localMidnight + (hour - utcOffsetHours) * HOUR + minute * 60_000;
}

function localHourNow(context: HistoryContext): number {
  return new Date(context.startMs + context.utcOffsetHours * HOUR).getUTCHours();
}

function titleFor(lineItems: WorldLineItem[], context: HistoryContext): string {
  const service = context.catalog.find((entry) => entry.key === lineItems[0]!.catalogKey)!;
  return service.jobTitle ?? service.name;
}

function lineItem(entry: CatalogEntry, quantity: number): WorldLineItem {
  return { catalogKey: entry.key, name: entry.name, description: entry.description, quantity, unitPrice: entry.unitPrice };
}

function pickDistinct<T>(random: SeededRandom, items: readonly T[], count: number): T[] {
  const pool = [...items];
  return Array.from({ length: Math.min(count, pool.length) }, () => pool.splice(random.int(0, pool.length - 1), 1)[0]!);
}

function iso(ms: number): string {
  return new Date(ms).toISOString();
}
