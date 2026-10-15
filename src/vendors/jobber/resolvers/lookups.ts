import type { JobberInvoice, JobberJob, JobberQuote, JobberState, JobberVisit } from "../types.ts";

/**
 * Which records belong to each client, job, and quote, gathered in one pass over state. Without them, each job on a
 * page read every visit and invoice in the business to find its own, so a page of 100 jobs read them all 100 times.
 * Lists keep the order state keeps (number order), except a job's visits, which come in the order they happen.
 */
export interface Lookups {
  jobsOfClient: Map<string, JobberJob[]>;
  jobsOfQuote: Map<string, JobberJob[]>;
  quotesOfClient: Map<string, JobberQuote[]>;
  invoicesOfClient: Map<string, JobberInvoice[]>;
  invoicesOfJob: Map<string, JobberInvoice[]>;
  visitsOfJob: Map<string, JobberVisit[]>;
}

export function gatherLookups(state: JobberState): Lookups {
  const lookups: Lookups = {
    jobsOfClient: new Map(),
    jobsOfQuote: new Map(),
    quotesOfClient: new Map(),
    invoicesOfClient: new Map(),
    invoicesOfJob: new Map(),
    visitsOfJob: new Map(),
  };
  for (const job of state.jobs.values()) {
    add(lookups.jobsOfClient, job.clientId, job);
    if (job.quoteId) add(lookups.jobsOfQuote, job.quoteId, job);
  }
  for (const quote of state.quotes.values()) add(lookups.quotesOfClient, quote.clientId, quote);
  for (const invoice of state.invoices.values()) {
    add(lookups.invoicesOfClient, invoice.clientId, invoice);
    for (const jobId of new Set(invoice.jobIds)) add(lookups.invoicesOfJob, jobId, invoice);
  }
  for (const visit of state.visits.values()) add(lookups.visitsOfJob, visit.jobId, visit);
  for (const visits of lookups.visitsOfJob.values()) visits.sort((a, b) => a.startAt.localeCompare(b.startAt));
  return lookups;
}

function add<T>(lists: Map<string, T[]>, key: string, record: T): void {
  const list = lists.get(key);
  if (list) list.push(record);
  else lists.set(key, [record]);
}
