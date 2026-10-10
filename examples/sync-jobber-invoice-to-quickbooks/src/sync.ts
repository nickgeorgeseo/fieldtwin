import type { JobberClient } from "./jobber.ts";
import { fetchPaidInvoice, fetchPaidInvoicesSince, type JobberInvoice, type JobberLineItem } from "./jobber-invoices.ts";
import { type QuickBooksClient, QuickBooksError } from "./quickbooks.ts";
import * as books from "./quickbooks-entities.ts";
import { ensureActive, ensureCustomer } from "./sync-customers.ts";
import { OAuthError, TokenEndpointError } from "./token-endpoint.ts";

/**
 * Sync paid Jobber invoices into QuickBooks: the customer, the invoice, and the payment that settled it.
 *
 * Jobber is where the work is done and paid for; QuickBooks is the books. For every Jobber invoice that is paid
 * and has changed since `since`:
 *   1. ensure the customer (sync-customers.ts: matched by email, created if missing, made active if a write needs it);
 *   2. ensure the invoice: DocNumber is Jobber's invoice number, the usual way businesses keep the two matched;
 *   3. ensure the payment: pay what's still open, up to what Jobber says was paid, once (PaymentRefNum JOBBER-<n>);
 *   4. stamp the invoice's PrivateNote, so whoever reads the books can see where it came from.
 *
 * Every step looks before it writes, so a second run changes nothing and a run that died halfway is finished by
 * the next one. One invoice failing doesn't stop the others; a lost connection (OAuthError) or a token endpoint that
 * is down (TokenEndpointError) does, since nothing else would work either.
 */

export interface SyncClients {
  jobber: JobberClient;
  quickbooks: QuickBooksClient;
  log: (line: string) => void;
}

export interface SyncStats {
  invoices: number; // paid Jobber invoices changed since `since`
  customersCreated: number;
  customersSpelledDifferently: number; // matched by email, with a different name in the books; left as is
  customersReactivated: number; // inactive in the books, made active again to book new work
  invoicesCreated: number;
  paymentsCreated: number;
  invoicesStamped: number;
  staleRetries: number; // 5010 Stale Object, recovered by reading the invoice again
  conflicts: number; // the invoice number is already another customer's invoice in QuickBooks
  failed: number;
}

export interface SyncContext extends SyncClients {
  stats: SyncStats;
  customers: Map<string, books.Customer>; // by Jobber client id, for this run
  items: Map<string, books.Item>; // by line item name, for this run
}

export const stampFor = (invoiceNumber: string) => `Synced from Jobber invoice #${invoiceNumber}`;
const STALE_RETRIES = 3;

/** The scheduled sync: every paid invoice changed since `since`, found by paging through Jobber's invoices. */
export async function syncPaidInvoices(clients: SyncClients, since: string): Promise<SyncStats> {
  return syncAll(clients, await fetchPaidInvoicesSince(clients.jobber, since));
}

/** One invoice, by its Jobber id: what an INVOICE_UPDATE webhook asks for. An unpaid invoice has nothing to sync. */
export async function syncPaidInvoice(clients: SyncClients, invoiceId: string): Promise<SyncStats> {
  const invoice = await fetchPaidInvoice(clients.jobber, invoiceId);
  return syncAll(clients, invoice ? [invoice] : []);
}

export function emptyStats(): SyncStats {
  return {
    invoices: 0,
    customersCreated: 0,
    customersSpelledDifferently: 0,
    customersReactivated: 0,
    invoicesCreated: 0,
    paymentsCreated: 0,
    invoicesStamped: 0,
    staleRetries: 0,
    conflicts: 0,
    failed: 0,
  };
}

async function syncAll(clients: SyncClients, invoices: JobberInvoice[]): Promise<SyncStats> {
  const stats = { ...emptyStats(), invoices: invoices.length };
  const context: SyncContext = { ...clients, stats, customers: new Map(), items: new Map() };
  for (const invoice of invoices) {
    try {
      await syncInvoice(invoice, context);
    } catch (error) {
      if (error instanceof OAuthError || error instanceof TokenEndpointError) throw error;
      stats.failed++;
      clients.log(`Invoice #${invoice.invoiceNumber} not synced: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  return stats;
}

async function syncInvoice(invoice: JobberInvoice, context: SyncContext): Promise<void> {
  const customer = await ensureCustomer(invoice.client, context);
  const booked = await ensureInvoice(invoice, customer, context);
  if (!booked) return;
  await ensurePayment(invoice, booked, context);
  await stamp(booked, invoice.invoiceNumber, context);
}

async function ensureInvoice(invoice: JobberInvoice, customer: books.Customer, context: SyncContext): Promise<books.Invoice | undefined> {
  const { quickbooks, stats, log } = context;
  const existing = await books.findInvoiceByDocNumber(quickbooks, invoice.invoiceNumber);
  if (existing) {
    if (existing.CustomerRef.value === customer.Id) return existing;
    stats.conflicts++;
    const owner = existing.CustomerRef.name ?? `customer ${existing.CustomerRef.value}`;
    log(
      `Invoice #${invoice.invoiceNumber}: QuickBooks already has that number for ${owner}, not ${customer.DisplayName}. Skipped; check it by hand.`,
    );
    return undefined;
  }

  const Line: books.SalesLine[] = [];
  for (const line of invoice.lineItems) {
    const item = context.items.get(line.name) ?? (await books.itemForLine(quickbooks, line.name, log));
    context.items.set(line.name, item);
    Line.push(salesLineFor(line, item.Id));
  }

  await ensureActive(invoice.client, invoice.invoiceNumber, context);
  const created = await books.createInvoice(quickbooks, {
    CustomerRef: { value: customer.Id },
    DocNumber: invoice.invoiceNumber,
    ...(invoice.issuedDate && { TxnDate: dateOf(invoice.issuedDate) }),
    ...(invoice.dueDate && { DueDate: dateOf(invoice.dueDate) }),
    ...(invoice.client.email && { BillEmail: { Address: invoice.client.email } }),
    Line,
  });
  stats.invoicesCreated++;
  if (cents(created.TotalAmt) !== cents(invoice.amounts.total)) {
    log(`Invoice #${invoice.invoiceNumber}: QuickBooks totals it ${created.TotalAmt}, Jobber ${invoice.amounts.total} (tax or rounding?).`);
  }
  return created;
}

/**
 * A Jobber line item as a QuickBooks sales line, booked to the Item `itemId`. QuickBooks refuses a line whose Amount
 * isn't Qty × UnitPrice to the cent (6070), and a Jobber price can be finer than a cent, so Qty and UnitPrice go along
 * only when they agree with the total. Otherwise the line is booked at its total, and its description says how
 * Jobber priced it: an invoice that fails every run would hold the scheduled sync's cutoff back for good.
 */
export function salesLineFor(line: JobberLineItem, itemId: string): books.SalesLine {
  const description = line.description ?? line.name;
  const agrees = line.unitPrice !== null && cents(line.quantity * line.unitPrice) === cents(line.totalPrice);
  const priced = line.unitPrice === null ? { Qty: line.quantity } : agrees ? { Qty: line.quantity, UnitPrice: line.unitPrice } : {};
  return {
    DetailType: "SalesItemLineDetail",
    Amount: line.totalPrice,
    Description: agrees || line.unitPrice === null ? description : `${description} (${line.quantity} × ${line.unitPrice})`,
    SalesItemLineDetail: { ItemRef: { value: itemId }, ...priced },
  };
}

async function ensurePayment(invoice: JobberInvoice, booked: books.Invoice, context: SyncContext): Promise<void> {
  const { quickbooks, stats } = context;
  // Pay what's still open, but never more than Jobber says was paid. Nothing open: the books already have it.
  const amount = Math.min(cents(booked.Balance), cents(invoice.amounts.paymentsTotal)) / 100;
  if (amount <= 0) return;
  const PaymentRefNum = `JOBBER-${invoice.invoiceNumber}`;
  if (await books.findPaymentByRef(quickbooks, PaymentRefNum)) return; // recorded by an earlier run

  await ensureActive(invoice.client, invoice.invoiceNumber, context);
  await books.createPayment(quickbooks, {
    CustomerRef: { value: booked.CustomerRef.value },
    TotalAmt: amount,
    PaymentRefNum,
    Line: [{ Amount: amount, LinkedTxn: [{ TxnId: booked.Id, TxnType: "Invoice" }] }],
  });
  stats.paymentsCreated++;
}

/**
 * Notes where the invoice came from, keeping any note a person already wrote. `booked` is the invoice as it was
 * before the payment, and recording a payment changes an invoice (its Balance), so the SyncToken in hand may be
 * stale. QuickBooks then answers 5010, and the recovery is the documented one: read it again and retry.
 */
async function stamp(booked: books.Invoice, invoiceNumber: string, context: SyncContext): Promise<void> {
  const { quickbooks, stats } = context;
  const note = stampFor(invoiceNumber);
  let current = booked;
  for (let attempt = 1; ; attempt++) {
    if (current.PrivateNote?.includes(note)) return;
    const PrivateNote = current.PrivateNote ? `${current.PrivateNote}\n${note}` : note;
    try {
      await books.updateInvoice(quickbooks, { Id: current.Id, SyncToken: current.SyncToken, PrivateNote });
      stats.invoicesStamped++;
      return;
    } catch (error) {
      if (!(error instanceof QuickBooksError && error.code === "5010") || attempt >= STALE_RETRIES) throw error;
      stats.staleRetries++;
      current = await books.readInvoice(quickbooks, current.Id);
    }
  }
}

/** Jobber sends date-times; QuickBooks transaction dates are YYYY-MM-DD. The date as Jobber wrote it. */
function dateOf(dateTime: string): string {
  return dateTime.slice(0, 10);
}

/** Whole cents, half a cent rounding away from zero. toFixed first: 2.5 × 33.33 is 83.32499999999999 in floating point. */
function cents(amount: number): number {
  return Math.sign(amount) * Math.round(Number((Math.abs(amount) * 100).toFixed(6)));
}
