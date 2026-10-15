import { sumMoney } from "../../../core/money.ts";
import type { JobberJob, JobberVisit } from "../types.ts";
import { clientNode } from "./clients.ts";
import { connection, type PageArgs } from "./connection.ts";
import type { ResolverContext } from "./context.ts";
import { invoiceAmounts, invoicesConnection, invoicesFor } from "./invoices.ts";
import { quoteNode } from "./quotes.ts";
import { jobStatus, visitStatus } from "./statuses.ts";
import { userNode } from "./users.ts";

/** Job and Visit: https://developer.getjobber.com/docs (Important Objects: Job, Visit) */

export function jobNode(job: JobberJob, context: ResolverContext) {
  const visits = context.lookups().visitsOfJob.get(job.id) ?? []; // in the order they happen
  const { utcOffsetHours } = context.state().account;
  const finished = visits.length > 0 && visits.every((visit) => visit.completedAt);
  const invoices = invoicesFor(context, { jobId: job.id });
  const total = sumMoney(job.lineItems.map((line) => line.totalPrice));
  const invoicedTotal = sumMoney(invoices.map((invoice) => invoiceAmounts(invoice).total));
  return {
    ...job,
    jobStatus: () => jobStatus(visits, invoices.length > 0, context.nowMs(), utcOffsetHours),
    client: () => clientNode(context.state().clients.get(job.clientId)!, context),
    startAt: visits[0]?.startAt ?? null,
    endAt: visits.at(-1)?.endAt ?? null,
    completedAt: finished ? visits.at(-1)!.completedAt : null,
    total, // "The total chargeable amount of the job"
    invoicedTotal,
    uninvoicedTotal: Math.max(0, sumMoney([total, -invoicedTotal])),
    invoices: (args: PageArgs) => invoicesConnection(args, context, { jobId: job.id }),
    quote: () => (job.quoteId ? quoteNode(context.state().quotes.get(job.quoteId)!, context) : null),
    lineItems: (args: PageArgs) => connection(job.lineItems, args, (line) => line),
    visits: (args: PageArgs) => connection(visits, args, (visit) => visitNode(visit, context)),
  };
}

export function visitNode(visit: JobberVisit, context: ResolverContext) {
  const { state, nowMs } = context;
  return {
    ...visit,
    visitStatus: () => visitStatus(visit, nowMs(), state().account.utcOffsetHours),
    isComplete: visit.completedAt !== null,
    allDay: false,
    duration: (Date.parse(visit.endAt) - Date.parse(visit.startAt)) / 60_000, // minutes
    client: () => clientNode(state().clients.get(visit.clientId)!, context),
    job: () => jobNode(state().jobs.get(visit.jobId)!, context),
    assignedUsers: (args: PageArgs) => connection(visit.assignedUserIds, args, (id) => userNode(state().users.get(id)!)),
  };
}

/** All jobs, or one client's, in job-number order. */
export function jobsConnection(args: PageArgs, context: ResolverContext, clientId?: string) {
  const jobs = clientId ? (context.lookups().jobsOfClient.get(clientId) ?? []) : [...context.state().jobs.values()];
  return connection(jobs, args, (job) => jobNode(job, context));
}
