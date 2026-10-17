import type { Books, JobberClient, QboCustomer, QboInvoice } from "./books.ts";

/**
 * Where Jobber and QuickBooks agree about the business, and where they have drifted apart. Customers match by email,
 * as the reference integration matches them (names drift between systems; emails don't). Invoices match by number,
 * one to one: the integration books Jobber's invoice number as QuickBooks' DocNumber, as the seeded books do.
 */

export type CustomerStatus = "only-in-jobber" | "only-in-quickbooks" | "inactive-in-quickbooks" | "spelled-differently" | "same";

export interface CustomerRow {
  email: string;
  jobber?: { id: string; name: string };
  quickbooks?: { id: string; name: string; active: boolean };
  status: CustomerStatus;
}

const CUSTOMER_ORDER: CustomerStatus[] = ["only-in-jobber", "only-in-quickbooks", "inactive-in-quickbooks", "spelled-differently", "same"];

export function matchCustomers({ jobber, quickbooks }: Books): CustomerRow[] {
  const rows = new Map<string, CustomerRow>();
  for (const client of jobber.clients) {
    const email = clientEmail(client);
    rows.set(email || `jobber:${client.id}`, { email, jobber: { id: client.id, name: clientName(client) }, status: "only-in-jobber" });
  }
  for (const customer of quickbooks.customers) {
    const email = customerEmail(customer);
    const key = email || `quickbooks:${customer.Id}`;
    const row = rows.get(key) ?? { email, status: "only-in-quickbooks" };
    row.quickbooks = { id: customer.Id, name: customer.DisplayName, active: customer.Active !== false };
    row.status = customerStatus(row);
    rows.set(key, row);
  }
  return [...rows.values()].sort(
    (a, b) => CUSTOMER_ORDER.indexOf(a.status) - CUSTOMER_ORDER.indexOf(b.status) || nameOf(a).localeCompare(nameOf(b)),
  );
}

function customerStatus({ jobber, quickbooks }: CustomerRow): CustomerStatus {
  if (!jobber) return "only-in-quickbooks";
  if (!quickbooks) return "only-in-jobber";
  if (!quickbooks.active) return "inactive-in-quickbooks";
  return sameName(jobber.name, quickbooks.name) ? "same" : "spelled-differently";
}

export type InvoiceStatus =
  | "paid-not-booked"
  | "payment-not-recorded"
  | "totals-differ"
  | "paid-only-in-quickbooks"
  | "open-not-booked"
  | "only-in-quickbooks"
  | "in-sync";

export interface InvoiceRow {
  number: string;
  jobber?: { client: string; total: number; paid: boolean };
  quickbooks?: { id: string; customer: string; total: number; balance: number };
  status: InvoiceStatus;
}

const INVOICE_ORDER: InvoiceStatus[] = [
  "paid-not-booked",
  "payment-not-recorded",
  "totals-differ",
  "paid-only-in-quickbooks",
  "open-not-booked",
  "only-in-quickbooks",
  "in-sync",
];

export function matchInvoices({ jobber, quickbooks }: Books): InvoiceRow[] {
  const clients = new Map(jobber.clients.map((client) => [client.id, clientName(client)]));
  const pairs = pairUp(
    jobber.invoices,
    (invoice) => invoice.invoiceNumber,
    quickbooks.invoices,
    (invoice) => invoice.DocNumber ?? "",
  );
  const rows: InvoiceRow[] = jobber.invoices.map((invoice) => {
    const row: InvoiceRow = {
      number: invoice.invoiceNumber,
      jobber: {
        client: clients.get(invoice.clientId) ?? "",
        total: cents(invoice.lineItems.reduce((sum, line) => sum + line.totalPrice, 0)),
        paid: invoice.paidAt !== null,
      },
      status: "in-sync",
    };
    const books = pairs.get(invoice);
    if (books) row.quickbooks = asBooked(books);
    row.status = invoiceStatus(row);
    return row;
  });
  const paired = new Set(pairs.values());
  for (const invoice of quickbooks.invoices) {
    if (paired.has(invoice)) continue;
    rows.push({
      number: invoice.DocNumber ?? `Id ${invoice.Id}`,
      quickbooks: asBooked(invoice),
      status: "only-in-quickbooks",
    });
  }
  return rows.sort(
    (a, b) =>
      INVOICE_ORDER.indexOf(a.status) - INVOICE_ORDER.indexOf(b.status) ||
      Number(b.number) - Number(a.number) ||
      b.number.localeCompare(a.number),
  );
}

/** Pairs each field-service invoice with the first invoice in the books that has the same key and isn't paired yet. */
function pairUp<F, B>(field: F[], fieldKey: (invoice: F) => string, books: B[], booksKey: (invoice: B) => string): Map<F, B> {
  const waiting = new Map<string, B[]>();
  for (const invoice of books) {
    const key = booksKey(invoice);
    if (!key) continue;
    const queue = waiting.get(key) ?? [];
    queue.push(invoice);
    waiting.set(key, queue);
  }
  const pairs = new Map<F, B>();
  for (const invoice of field) {
    const match = waiting.get(fieldKey(invoice))?.shift();
    if (match) pairs.set(invoice, match);
  }
  return pairs;
}

function asBooked(invoice: QboInvoice): InvoiceRow["quickbooks"] {
  return { id: invoice.Id, customer: invoice.CustomerRef.name ?? "", total: invoice.TotalAmt, balance: invoice.Balance };
}

function invoiceStatus({ jobber, quickbooks }: InvoiceRow): InvoiceStatus {
  if (!quickbooks) return jobber?.paid ? "paid-not-booked" : "open-not-booked";
  if (!jobber) return "only-in-quickbooks";
  if (Math.abs(jobber.total - quickbooks.total) >= 0.005) return "totals-differ";
  if (jobber.paid && quickbooks.balance > 0) return "payment-not-recorded";
  if (!jobber.paid && quickbooks.balance === 0) return "paid-only-in-quickbooks";
  return "in-sync";
}

function clientEmail(client: JobberClient): string {
  return (client.emails.find((email) => email.primary) ?? client.emails[0])?.address.toLowerCase() ?? "";
}

function customerEmail(customer: QboCustomer): string {
  return customer.PrimaryEmailAddr?.Address?.toLowerCase() ?? "";
}

function clientName(client: JobberClient): string {
  return [client.firstName, client.lastName].filter(Boolean).join(" ") || client.companyName || "";
}

function nameOf(row: CustomerRow): string {
  return row.jobber?.name ?? row.quickbooks?.name ?? "";
}

function sameName(a: string, b: string): boolean {
  return a.trim().toLowerCase() === b.trim().toLowerCase();
}

function cents(amount: number): number {
  return Math.round(amount * 100) / 100;
}
