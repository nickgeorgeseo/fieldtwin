import { sumMoney } from "../../../core/money.ts";
import type { JobberInvoice } from "../types.ts";
import { clientNode } from "./clients.ts";
import { connection, type PageArgs } from "./connection.ts";
import type { ResolverContext } from "./context.ts";
import { jobNode } from "./jobs.ts";
import { invoiceStatus } from "./statuses.ts";

/** Invoice: https://developer.getjobber.com/docs (Important Objects: Invoice) */
export function invoiceNode(invoice: JobberInvoice, context: ResolverContext) {
  const { state, nowMs } = context;
  return {
    ...invoice,
    invoiceStatus: () => invoiceStatus(invoice, nowMs(), state().account.utcOffsetHours),
    amounts: invoiceAmounts(invoice),
    client: () => clientNode(state().clients.get(invoice.clientId)!, context),
    lineItems: (args: PageArgs) => connection(invoice.lineItems, args, (line) => line),
    jobs: (args: PageArgs) =>
      connection(
        invoice.jobIds.map((id) => state().jobs.get(id)!),
        args,
        (job) => jobNode(job, context),
      ),
  };
}

/** No taxes, discounts, or partial payments in the twin: an invoice is either fully paid or fully open. */
export function invoiceAmounts(invoice: JobberInvoice) {
  const total = sumMoney(invoice.lineItems.map((line) => line.totalPrice));
  const paymentsTotal = invoice.paidAt ? total : 0;
  return { subtotal: total, total, paymentsTotal, invoiceBalance: sumMoney([total, -paymentsTotal]) };
}

/** All invoices, one client's, or one job's, in invoice-number order. */
export function invoicesFor(context: ResolverContext, filter: { clientId?: string; jobId?: string } = {}): JobberInvoice[] {
  return [...context.state().invoices.values()].filter(
    (invoice) => (!filter.clientId || invoice.clientId === filter.clientId) && (!filter.jobId || invoice.jobIds.includes(filter.jobId)),
  );
}

export function invoicesConnection(args: PageArgs, context: ResolverContext, filter: { clientId?: string; jobId?: string } = {}) {
  return connection(invoicesFor(context, filter), args, (invoice) => invoiceNode(invoice, context));
}
