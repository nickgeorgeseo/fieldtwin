import { sumMoney } from "../../../core/money.ts";
import type { JobberQuote } from "../types.ts";
import { clientNode } from "./clients.ts";
import { connection, type PageArgs } from "./connection.ts";
import type { ResolverContext } from "./context.ts";
import { jobNode } from "./jobs.ts";

/** Quote: https://developer.getjobber.com/docs (Important Objects: Quote) */
export function quoteNode(quote: JobberQuote, context: ResolverContext) {
  const jobs = context.lookups().jobsOfQuote.get(quote.id) ?? [];
  const total = sumMoney(quote.lineItems.map((line) => line.totalPrice));
  const status = quoteStatus(quote, jobs.length > 0);
  return {
    ...quote,
    quoteStatus: status,
    // "Time the quote transitioned to its current status"
    transitionedAt: status === "converted" ? jobs[0]!.createdAt : (quote.approvedAt ?? quote.sentAt ?? quote.createdAt),
    client: () => clientNode(context.state().clients.get(quote.clientId)!, context),
    amounts: { subtotal: total, total }, // no taxes or discounts in the twin
    lineItems: (args: PageArgs) => connection(quote.lineItems, args, (line) => line),
    jobs: (args: PageArgs) => connection(jobs, args, (job) => jobNode(job, context)),
  };
}

/** A quote that became a job is converted; otherwise its status follows how far the client has got. */
function quoteStatus(quote: JobberQuote, hasJobs: boolean): string {
  if (hasJobs) return "converted";
  if (quote.approvedAt) return "approved";
  return quote.sentAt ? "awaiting_response" : "draft";
}

/** All quotes, or one client's, in quote-number order. */
export function quotesConnection(args: PageArgs, context: ResolverContext, clientId?: string) {
  const quotes = clientId ? (context.lookups().quotesOfClient.get(clientId) ?? []) : [...context.state().quotes.values()];
  return connection(quotes, args, (quote) => quoteNode(quote, context));
}
