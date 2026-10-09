import { type JobberClient, JobberError } from "./jobber.ts";

/**
 * Paid Jobber invoices, with what QuickBooks needs to book them: the client, the amounts, and the line items.
 * Invoice fields: https://developer.getjobber.com/docs (Important Objects: Invoice)
 *
 * Jobber's filter arguments aren't in the public docs, so this pages through every invoice and filters here
 * (paid, and updated since the last run). With a documented filter you'd pass it to `invoices` instead and
 * spend fewer points. Pages are explicit at every level: a connection without `first` is priced at 100 nodes,
 * so nested ones get expensive fast.
 */

export interface JobberInvoice {
  id: string;
  invoiceNumber: string;
  subject: string;
  issuedDate: string | null;
  dueDate: string | null;
  updatedAt: string;
  amounts: { total: number; paymentsTotal: number; invoiceBalance: number };
  client: JobberInvoiceClient;
  lineItems: JobberLineItem[];
}

export interface JobberInvoiceClient {
  id: string;
  name: string;
  firstName: string;
  lastName: string;
  companyName: string | null;
  email: string | null;
}

export interface JobberLineItem {
  name: string;
  description: string | null;
  quantity: number;
  unitPrice: number | null;
  totalPrice: number;
}

export const PAGE_SIZES = { invoices: 25, lineItems: 20 };

interface Page<T> {
  nodes: T[];
  pageInfo: { hasNextPage: boolean; endCursor: string | null };
}

type InvoiceNode = Omit<JobberInvoice, "client" | "lineItems"> & {
  invoiceStatus: string;
  client: JobberInvoiceClient | null;
  lineItems: Page<JobberLineItem>;
};

const LINE_ITEM_FIELDS = "nodes { name description quantity unitPrice totalPrice } pageInfo { hasNextPage endCursor }";

const INVOICES = `
  query Invoices($first: Int!, $after: String, $lines: Int!) {
    invoices(first: $first, after: $after) {
      nodes {
        id invoiceNumber invoiceStatus subject issuedDate dueDate updatedAt
        amounts { total paymentsTotal invoiceBalance }
        client { id name firstName lastName companyName email }
        lineItems(first: $lines) { ${LINE_ITEM_FIELDS} }
      }
      pageInfo { hasNextPage endCursor }
    }
  }`;

const MORE_LINE_ITEMS = `
  query InvoiceLineItems($id: EncodedId!, $lines: Int!, $after: String) {
    invoice(id: $id) { lineItems(first: $lines, after: $after) { ${LINE_ITEM_FIELDS} } }
  }`;

/** Every paid invoice updated after `since` (an ISO time), oldest invoice number first. */
export async function fetchPaidInvoicesSince(jobber: JobberClient, since: string, pageSizes = PAGE_SIZES): Promise<JobberInvoice[]> {
  const sinceMs = Date.parse(since);
  const paid: JobberInvoice[] = [];
  let after: string | null = null;
  do {
    const variables: Record<string, unknown> = { first: pageSizes.invoices, after, lines: pageSizes.lineItems };
    const { invoices } = await jobber.query<{ invoices: Page<InvoiceNode> }>(INVOICES, variables);
    for (const node of invoices.nodes) {
      // Invoice.client is nullable in the schema; an invoice with no client can't be booked to a customer.
      if (node.invoiceStatus !== "paid" || Date.parse(node.updatedAt) <= sinceMs || !node.client) continue;
      const { invoiceStatus: _status, lineItems, client, ...invoice } = node;
      paid.push({ ...invoice, client, lineItems: [...lineItems.nodes, ...(await moreLineItems(jobber, node.id, lineItems, pageSizes))] });
    }
    after = invoices.pageInfo.hasNextPage ? invoices.pageInfo.endCursor : null;
  } while (after);
  return paid;
}

/** The rest of an invoice's line items, when there are more than one page of them. */
async function moreLineItems(jobber: JobberClient, id: string, firstPage: Page<JobberLineItem>, pageSizes = PAGE_SIZES) {
  const more: JobberLineItem[] = [];
  let page = firstPage;
  while (page.pageInfo.hasNextPage) {
    const variables = { id, lines: pageSizes.lineItems, after: page.pageInfo.endCursor };
    const { invoice } = await jobber.query<{ invoice: { lineItems: Page<JobberLineItem> } | null }>(MORE_LINE_ITEMS, variables);
    if (!invoice) throw new JobberError(`Invoice ${id} disappeared while its line items were being read.`);
    page = invoice.lineItems;
    more.push(...page.nodes);
  }
  return more;
}
