import { bookedCustomer } from "./booked-customer.ts";
import type { Books, QboCustomer, QboInvoice } from "./books.ts";
import { fieldServiceRecords } from "./field-service.ts";
import type { FieldService } from "./vendors.ts";

/**
 * Where a field-service system and QuickBooks agree about the business, and where they have drifted apart. The twin
 * keeps the business in two field-service systems, Jobber and Housecall Pro, so each is compared with the books on its
 * own. Customers match by email, as the reference integration matches them (names drift between systems; emails
 * don't). Invoices match by number, one to one: the integration books the field-service system's invoice number as
 * QuickBooks' DocNumber, as the seeded books do (Jobber and Housecall Pro number each invoice as the world does), and a
 * number booked for two customers pairs with the invoice's own customer's, as the integration finds it.
 */

export type CustomerStatus = "only-in-field-service" | "only-in-quickbooks" | "inactive-in-quickbooks" | "spelled-differently" | "same";

export interface CustomerRow {
  email: string;
  service?: { id: string; name: string };
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
  const { customers } = fieldServiceRecords(books, service);
  const pairs = pairUp(customers, (customer) => customer.email, books.quickbooks.customers, customerEmail);
  const rows: CustomerRow[] = customers.map((customer) => {
    const row: CustomerRow = { email: customer.email, service: { id: customer.id, name: customer.name }, status: "only-in-field-service" };
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

function customerStatus({ service, quickbooks }: CustomerRow): CustomerStatus {
  if (!service) return "only-in-quickbooks";
  if (!quickbooks) return "only-in-field-service";
  if (!quickbooks.active) return "inactive-in-quickbooks";
  return sameName(service.name, quickbooks.name) ? "same" : "spelled-differently";
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
  service?: { customer: string; total: number; paid: boolean };
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
  const records = fieldServiceRecords(books, service);
  const customers = new Map(records.customers.map((customer) => [customer.id, customer.name]));
  // QuickBooks takes one DocNumber for two customers, and the sync then books against the customer's own invoice
  // (findInvoiceByDocNumber), so an invoice prefers the one booked for the customer the sync finds for its customer.
  const bookedFor = new Map(records.customers.map((customer) => [customer.id, bookedCustomer(customer, books.quickbooks.customers)?.Id]));
  const pairs = pairUp(
    records.invoices,
    (invoice) => invoice.number,
    books.quickbooks.invoices,
    (invoice) => invoice.DocNumber ?? "",
    (invoice, booked) => booked.CustomerRef.value === bookedFor.get(invoice.customerId),
  );
  const rows: InvoiceRow[] = records.invoices.map((invoice) => {
    const row: InvoiceRow = {
      number: invoice.number,
      service: { customer: customers.get(invoice.customerId) ?? "", total: invoice.cents / 100, paid: invoice.paid },
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
  // Newest number first. A DocNumber is free text ("5x"), so one comparison that reads the digits in it as numbers
  // keeps the order the same whatever order the log has them in. Numbers it reads as equal ("5" and "05") fall back to
  // the text itself, then to the QuickBooks Id, so no two rows ever tie.
  return rows.sort(
    (a, b) =>
      INVOICE_ORDER.indexOf(a.status) - INVOICE_ORDER.indexOf(b.status) ||
      b.number.localeCompare(a.number, "en", { numeric: true }) ||
      byText(b.number, a.number) ||
      byText(b.quickbooks?.id ?? "", a.quickbooks?.id ?? ""),
  );
}

/** Plain text order, code unit by code unit: never 0 for two different strings, unlike a locale's. */
function byText(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/**
 * Pairs each field-service record with the first record in the books that has the same key and isn't paired yet. With
 * `belongs`, every record first takes one that belongs to it, so one falling back to the first can't take another's.
 */
function pairUp<F, B>(
  fromService: F[],
  serviceKey: (record: F) => string,
  booked: B[],
  bookedKey: (record: B) => string,
  belongs?: (record: F, candidate: B) => boolean,
): Map<F, B> {
  const waiting = new Map<string, B[]>();
  for (const record of booked) {
    const key = bookedKey(record);
    if (!key) continue;
    const queue = waiting.get(key) ?? [];
    queue.push(record);
    waiting.set(key, queue);
  }
  const pairs = new Map<F, B>();
  const take = (record: F, fits: (candidate: B) => boolean) => {
    const queue = waiting.get(serviceKey(record)) ?? [];
    const at = queue.findIndex(fits);
    if (at >= 0) pairs.set(record, queue.splice(at, 1)[0]!);
  };
  if (belongs) for (const record of fromService) take(record, (candidate) => belongs(record, candidate));
  for (const record of fromService) if (!pairs.has(record)) take(record, () => true);
  return pairs;
}

function asBookedInvoice(invoice: QboInvoice): InvoiceRow["quickbooks"] {
  return { id: invoice.Id, customer: invoice.CustomerRef.name ?? "", total: invoice.TotalAmt, balance: invoice.Balance };
}

function invoiceStatus({ service, quickbooks }: InvoiceRow): InvoiceStatus {
  if (!quickbooks) return service?.paid ? "paid-not-booked" : "open-not-booked";
  if (!service) return "only-in-quickbooks";
  if (Math.abs(service.total - quickbooks.total) >= 0.005) return "totals-differ";
  if (service.paid && quickbooks.balance > 0) return "payment-not-recorded";
  if (!service.paid && quickbooks.balance === 0) return "paid-only-in-quickbooks";
  return "in-sync";
}

function customerEmail(customer: QboCustomer): string {
  return customer.PrimaryEmailAddr?.Address?.toLowerCase() ?? "";
}

function nameOf(row: CustomerRow): string {
  return row.service?.name ?? row.quickbooks?.name ?? "";
}

function sameName(a: string, b: string): boolean {
  return a.trim().toLowerCase() === b.trim().toLowerCase();
}
