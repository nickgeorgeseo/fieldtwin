import type { Books, QboCustomer, QboInvoice } from "./books.ts";
import { type FieldService, fieldSide } from "./field-side.ts";

/**
 * Where a field-service system and QuickBooks agree about the business, and where they have drifted apart. The twin
 * keeps the business in two field-service systems, Jobber and Housecall Pro, so each is compared with the books on its
 * own. Customers match by email, as the reference integration matches them (names drift between systems; emails
 * don't). Invoices match by number, one to one: the integration books the field-service system's invoice number as
 * QuickBooks' DocNumber, as the seeded books do (Jobber and Housecall Pro number each invoice as the world does).
 */

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
    if (booked) row.quickbooks = asBookedInvoice(booked);
    row.status = invoiceStatus(row);
    return row;
  });
  const paired = new Set(pairs.values());
  for (const invoice of books.quickbooks.invoices) {
    if (paired.has(invoice)) continue;
    rows.push({
      number: invoice.DocNumber ?? `Id ${invoice.Id}`,
      quickbooks: asBookedInvoice(invoice),
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

function asBookedInvoice(invoice: QboInvoice): InvoiceRow["quickbooks"] {
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

function customerEmail(customer: QboCustomer): string {
  return customer.PrimaryEmailAddr?.Address?.toLowerCase() ?? "";
}

function nameOf(row: CustomerRow): string {
  return row.field?.name ?? row.quickbooks?.name ?? "";
}

function sameName(a: string, b: string): boolean {
  return a.trim().toLowerCase() === b.trim().toLowerCase();
}
