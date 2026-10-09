import type { SeededRandom } from "../core/random.ts";
import type { CatalogEntry } from "./catalog.ts";
import type { WorldCustomer, WorldTechnician } from "./generate-world.ts";
import { type JobStory, jobStory, openQuote } from "./history-stories.ts";

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

const PAST_DAYS = 90;
const SCHEDULE_DAYS = 14;

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

/** Sort by creation time and give each record its number and key ("job-0001"), the way the business would. */
function numberInOrder<T extends { key: string; number: number; createdAt: string }>(records: T[], prefix: string): T[] {
  records.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  records.forEach((record, index) => {
    record.number = index + 1;
    record.key = `${prefix}-${pad(index + 1)}`;
  });
  return records;
}

function pad(n: number): string {
  return String(n).padStart(4, "0");
}
