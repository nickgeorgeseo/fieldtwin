import { type Books, type HcpCustomer, hcpLinesCents, type JobberClient, type QboCustomer, type QboInvoice } from "./books.ts";

/**
 * Where a field-service system and QuickBooks agree about the business, and where they have drifted apart. The twin
 * keeps the business in two field-service systems, Jobber and Housecall Pro, so each is compared with the books on its
 * own. Customers match by email, as the reference integration matches them (names drift between systems; emails
 * don't). Invoices match by number, one to one: the integration books the field-service system's invoice number as
 * QuickBooks' DocNumber, as the seeded books do (Jobber and Housecall Pro number each invoice as the world does).
 */

export type FieldService = "jobber" | "housecallpro";

export type CustomerStatus = "only-in-field-service" | "only-in-quickbooks" | "inactive-in-quickbooks" | "spelled-differently" | "same";

export interface CustomerRow {
  email: string;
  field?: { id: string; name: string };
  quickbooks?: { id: string; name: string; active: boolean };
  status: CustomerStatus;
}

const CUSTOMER_ORDER: CustomerStatus[] = [
  "only-in-field-service",
  "only-in-quickbooks",
  "inactive-in-quickbooks",
  "spelled-differently",
  "same",
];

/**
 * Pairs customers one to one, as invoices are: a customer either system has twice under one email shows as a row of its
 * own, since a sync that makes duplicates is what this page has to catch. A customer without an email pairs with none.
 */
export function matchCustomers(books: Books, service: FieldService): CustomerRow[] {
  const field = fieldSide(books, service).customers;
  const pairs = pairUp(field, (customer) => customer.email, books.quickbooks.customers, customerEmail);
  const rows: CustomerRow[] = field.map((customer) => {
    const row: CustomerRow = { email: customer.email, field: { id: customer.id, name: customer.name }, status: "only-in-field-service" };
    const booked = pairs.get(customer);
    if (booked) row.quickbooks = asBookedCustomer(booked);
    row.status = customerStatus(row);
    return row;
  });
  const paired = new Set(pairs.values());
  for (const customer of books.quickbooks.customers) {
    if (!paired.has(customer))
      rows.push({ email: customerEmail(customer), quickbooks: asBookedCustomer(customer), status: "only-in-quickbooks" });
  }
  return rows.sort((a, b) => CUSTOMER_ORDER.indexOf(a.status) - CUSTOMER_ORDER.indexOf(b.status) || nameOf(a).localeCompare(nameOf(b)));
}

function asBookedCustomer(customer: QboCustomer): CustomerRow["quickbooks"] {
  return { id: customer.Id, name: customer.DisplayName, active: customer.Active !== false };
}

function customerStatus({ field, quickbooks }: CustomerRow): CustomerStatus {
  if (!field) return "only-in-quickbooks";
  if (!quickbooks) return "only-in-field-service";
  if (!quickbooks.active) return "inactive-in-quickbooks";
  return sameName(field.name, quickbooks.name) ? "same" : "spelled-differently";
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
  field?: { customer: string; total: number; paid: boolean };
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

export function matchInvoices(books: Books, service: FieldService): InvoiceRow[] {
  const side = fieldSide(books, service);
  const customers = new Map(side.customers.map((customer) => [customer.id, customer.name]));
  const pairs = pairUp(
    side.invoices,
    (invoice) => invoice.number,
    books.quickbooks.invoices,
    (invoice) => invoice.DocNumber ?? "",
  );
  const rows: InvoiceRow[] = side.invoices.map((invoice) => {
    const row: InvoiceRow = {
      number: invoice.number,
      field: { customer: customers.get(invoice.customerId) ?? "", total: invoice.cents / 100, paid: invoice.paid },
      status: "in-sync",
    };
    const booked = pairs.get(invoice);
    if (booked) row.quickbooks = asBooked(booked);
    row.status = invoiceStatus(row);
    return row;
  });
  const paired = new Set(pairs.values());
  for (const invoice of books.quickbooks.invoices) {
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

/** Pairs each field-service record with the first record in the books that has the same key and isn't paired yet. */
function pairUp<F, B>(field: F[], fieldKey: (record: F) => string, books: B[], booksKey: (record: B) => string): Map<F, B> {
  const waiting = new Map<string, B[]>();
  for (const record of books) {
    const key = booksKey(record);
    if (!key) continue;
    const queue = waiting.get(key) ?? [];
    queue.push(record);
    waiting.set(key, queue);
  }
  const pairs = new Map<F, B>();
  for (const record of field) {
    const match = waiting.get(fieldKey(record))?.shift();
    if (match) pairs.set(record, match);
  }
  return pairs;
}

function asBooked(invoice: QboInvoice): InvoiceRow["quickbooks"] {
  return { id: invoice.Id, customer: invoice.CustomerRef.name ?? "", total: invoice.TotalAmt, balance: invoice.Balance };
}

function invoiceStatus({ field, quickbooks }: InvoiceRow): InvoiceStatus {
  if (!quickbooks) return field?.paid ? "paid-not-booked" : "open-not-booked";
  if (!field) return "only-in-quickbooks";
  if (Math.abs(field.total - quickbooks.total) >= 0.005) return "totals-differ";
  if (field.paid && quickbooks.balance > 0) return "payment-not-recorded";
  if (!field.paid && quickbooks.balance === 0) return "paid-only-in-quickbooks";
  return "in-sync";
}

/** A field-service system's customers and invoices, in the terms they are compared with the books in. */
interface FieldSide {
  customers: { id: string; name: string; email: string }[];
  invoices: { number: string; customerId: string; cents: number; paid: boolean }[];
}

function fieldSide(books: Books, service: FieldService): FieldSide {
  if (service === "jobber") {
    return {
      customers: books.jobber.clients.map((client) => ({ id: client.id, name: clientName(client), email: clientEmail(client) })),
      invoices: books.jobber.invoices.map((invoice) => ({
        number: invoice.invoiceNumber,
        customerId: invoice.clientId,
        cents: Math.round(invoice.lineItems.reduce((sum, line) => sum + line.totalPrice, 0) * 100),
        paid: invoice.paidAt !== null,
      })),
    };
  }
  return {
    customers: books.housecallpro.customers.map((customer) => ({
      id: customer.id,
      name: hcpCustomerName(customer),
      email: customer.email?.toLowerCase() ?? "",
    })),
    invoices: books.housecallpro.invoices.map((invoice) => ({
      number: invoice.invoice_number,
      customerId: invoice.customer_id,
      cents: hcpLinesCents(invoice.items), // in cents already
      paid: invoice.paid_at !== null,
    })),
  };
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

/** How Housecall Pro shows a customer: their name, or failing that their company, email, or a phone number. */
function hcpCustomerName(customer: HcpCustomer): string {
  const name = [customer.first_name, customer.last_name].filter(Boolean).join(" ");
  return name || customer.company || customer.email || customer.mobile_number || customer.home_number || customer.work_number || "";
}

function nameOf(row: CustomerRow): string {
  return row.field?.name ?? row.quickbooks?.name ?? "";
}

function sameName(a: string, b: string): boolean {
  return a.trim().toLowerCase() === b.trim().toLowerCase();
}
