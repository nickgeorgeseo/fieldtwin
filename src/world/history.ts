import type { SeededRandom } from "../core/random.ts";
import type { CatalogEntry } from "./catalog.ts";
import type { WorldCustomer, WorldTechnician } from "./generate-world.ts";

/**
 * The business's recent past and near future: about three months of jobs, the visits that did the work,
 * quotes for bigger jobs, and invoices (most paid, some not), plus the next two weeks on the schedule.
 *
 * History records facts, not vendor statuses: when a visit started and finished, when an invoice was issued
 * and paid. Each vendor works out its own statuses ("awaiting_payment", Balance 0) from those facts.
 */
export interface WorldHistory {
  jobs: WorldJob[];
  quotes: WorldQuote[];
  invoices: WorldInvoice[];
}

export interface WorldLineItem {
  catalogKey: string;
  name: string;
  description: string;
  quantity: number;
  unitPrice: number;
}

export interface WorldVisit {
  key: string;
  startAt: string;
  endAt: string;
  technicianKeys: string[];
  completedAt?: string; // set for visits that already happened
}

export interface WorldJob {
  key: string;
  number: number;
  customerKey: string;
  title: string;
  createdAt: string;
  lineItems: WorldLineItem[];
  visits: WorldVisit[];
  quoteKey?: string; // the quote this job was converted from
}

export interface WorldQuote {
  key: string;
  number: number;
  customerKey: string;
  title: string;
  createdAt: string;
  sentAt: string;
  lineItems: WorldLineItem[];
  approvedAt?: string;
  jobKey?: string; // the job it became, once approved
}

export interface WorldInvoice {
  key: string;
  number: number;
  customerKey: string;
  jobKey: string;
  createdAt: string; // the same moment as issuedAt
  issuedAt: string;
  dueAt: string;
  lineItems: WorldLineItem[];
  paidAt?: string;
}

export interface HistoryContext {
  random: SeededRandom;
  customers: WorldCustomer[];
  technicians: WorldTechnician[];
  catalog: CatalogEntry[];
  startMs: number;
  utcOffsetHours: number;
}

/** One job with the quote it came from and the invoice it produced, linked by reference until keys exist. */
interface JobStory {
  job: WorldJob;
  quote?: WorldQuote;
  invoice?: WorldInvoice;
}

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const PAST_DAYS = 90;
const SCHEDULE_DAYS = 14;
const BIG_JOB_PRICE = 500; // a service at least this price is quoted first and takes two visits
const NET_DAYS = 30;
const LAST_START_HOUR = 15; // local time; visits start between 8:00 and 15:30

export function makeHistory(context: HistoryContext): WorldHistory {
  const { random, customers } = context;
  const pastJobs = Math.round(customers.length * 1.4);
  const todaysJobs = Math.min(3, context.technicians.length);
  const laterJobs = Math.max(2, Math.round(customers.length / 4));

  const stories: JobStory[] = [
    ...Array.from({ length: pastJobs }, () => jobStory(context, random.int(-PAST_DAYS, -1))),
    ...Array.from({ length: todaysJobs }, () => jobStory(context, 0)),
    ...Array.from({ length: laterJobs }, () => jobStory(context, random.int(1, SCHEDULE_DAYS))),
  ];
  const openQuotes = Array.from({ length: Math.max(1, Math.round(customers.length / 8)) }, () => openQuote(context));

  const jobs = numberInOrder(
    stories.map((story) => story.job),
    "job",
  );
  const quotes = numberInOrder([...stories.flatMap((story) => (story.quote ? [story.quote] : [])), ...openQuotes], "quote");
  const invoices = numberInOrder(
    stories.flatMap((story) => (story.invoice ? [story.invoice] : [])),
    "invoice",
  );
  for (const { job, quote, invoice } of stories) {
    if (quote) {
      job.quoteKey = quote.key;
      quote.jobKey = job.key;
    }
    if (invoice) invoice.jobKey = job.key;
  }
  const visits = jobs.flatMap((job) => job.visits).sort((a, b) => a.startAt.localeCompare(b.startAt));
  visits.forEach((visit, index) => {
    visit.key = `visit-${pad(index + 1)}`;
  });

  return { jobs, quotes, invoices };
}

function jobStory(context: HistoryContext, requestedDay: number): JobStory {
  const { random, customers, technicians } = context;
  const lineItems = pickLineItems(context);
  const big = lineItems[0]!.unitPrice >= BIG_JOB_PRICE;

  // Keep every visit wholly in the past or wholly in the future: a big job in the past needs both of its
  // days behind it, and today's schedule only has room for visits that haven't started yet.
  let day = requestedDay;
  if (big && day === -1) day = -2;
  if (day === 0 && localHourNow(context) >= LAST_START_HOUR - 1) day = 1;

  const firstStart = businessHour(context, day, day === 0 ? localHourNow(context) + 1 : 8);
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
function openQuote(context: HistoryContext): WorldQuote {
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

/** Sort by creation time and give each record its number and key ("job-0001"), the way the business would. */
function numberInOrder<T extends { key: string; number: number; createdAt: string }>(records: T[], prefix: string): T[] {
  records.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  records.forEach((record, index) => {
    record.number = index + 1;
    record.key = `${prefix}-${pad(index + 1)}`;
  });
  return records;
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

function pad(n: number): string {
  return String(n).padStart(4, "0");
}
