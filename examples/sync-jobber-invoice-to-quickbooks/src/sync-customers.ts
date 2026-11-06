import type { JobberInvoiceClient } from "./jobber-invoices.ts";
import * as books from "./quickbooks-entities.ts";
import type { SyncContext } from "./sync.ts";

/**
 * The QuickBooks customer for a Jobber client.
 *
 * Match by email first: names drift between systems (typos, alternate spellings, "Bob" for "Robert"), while the
 * email address stays the same. A customer the books spell differently is matched and left alone, because the
 * books belong to the bookkeeper; the sync only says so in the log. Only a client with no email is matched by
 * name, which QuickBooks compares without regard to case. Anyone not found is created, so customers who exist
 * only in Jobber reach the books. Customers the bookkeeper made inactive are found too, and stay inactive until a
 * write needs them (ensureActive).
 */
export async function ensureCustomer(client: JobberInvoiceClient, context: SyncContext): Promise<books.Customer> {
  const known = context.customers.get(client.id);
  if (known) return known;
  const customer = (await findCustomer(client, context)) ?? (await createCustomer(client, context));
  context.customers.set(client.id, customer);
  return customer;
}

async function findCustomer(client: JobberInvoiceClient, { quickbooks, stats, log }: SyncContext) {
  const email = client.email?.trim();
  const name = bookName(client.name, MAX_LENGTHS.DisplayName);
  const found = email ? await books.findCustomerByEmail(quickbooks, email) : await books.findCustomerByName(quickbooks, name);
  // A name the sync gave the customer itself, when createCustomer found the plain one taken, is not drift.
  if (found && found.DisplayName !== name && !(email && found.DisplayName === books.nameWithEmail(name, email))) {
    // Queries compare text without regard to case, so a name match can still differ in letter case.
    const how = email ? "same email" : "same name, in other letter case";
    stats.customersSpelledDifferently++;
    log(`Customer "${client.name}" is "${found.DisplayName}" in QuickBooks (${how}). Matched, and left as the books have it.`);
  }
  return found;
}

/**
 * The client's customer, active: QuickBooks refuses new invoices and payments for an inactive one. Called just
 * before such a write, so a customer the bookkeeper retired is made active again only for work the books haven't
 * seen, never for history already in them, and the log says so for the bookkeeper.
 */
export async function ensureActive(client: JobberInvoiceClient, invoiceNumber: string, context: SyncContext): Promise<void> {
  const customer = context.customers.get(client.id);
  if (customer?.Active !== false) return;
  context.customers.set(client.id, await books.reactivateCustomer(context.quickbooks, customer));
  context.stats.customersReactivated++;
  context.log(`Customer "${customer.DisplayName}" was inactive in QuickBooks; made active again to book Jobber invoice #${invoiceNumber}.`);
}

async function createCustomer(client: JobberInvoiceClient, { quickbooks, stats, log }: SyncContext) {
  const email = client.email?.trim();
  const customer = await books.createCustomer(quickbooks, {
    DisplayName: bookName(client.name, MAX_LENGTHS.DisplayName),
    ...(client.firstName && { GivenName: bookName(client.firstName, MAX_LENGTHS.GivenName) }),
    ...(client.lastName && { FamilyName: bookName(client.lastName, MAX_LENGTHS.FamilyName) }),
    ...(client.companyName && { CompanyName: bookName(client.companyName, MAX_LENGTHS.CompanyName) }),
    ...(email && { PrimaryEmailAddr: { Address: email } }),
  });
  stats.customersCreated++;
  log(`Created customer "${customer.DisplayName}" in QuickBooks.`);
  return customer;
}

// Each name's "max character" in the Customer reference:
// https://developer.intuit.com/app/developer/qbo/docs/api/accounting/all-entities/customer
const MAX_LENGTHS = { DisplayName: 500, GivenName: 100, FamilyName: 100, CompanyName: 100 };

/**
 * A Jobber name as QuickBooks will take it. Customer names "must not contain colon (:), tab (\t), or newline (\n)
 * characters" (2040, Invalid String), and Jobber allows all three, so a client named "Northside Plumbing: Commercial"
 * would fail every run. A colon becomes a dash and a line break a space, which keeps the name recognizable.
 */
function bookName(name: string, maxLength: number): string {
  return name
    .replace(/\s*:\s*/g, " - ")
    .replace(/\s*[\t\r\n]\s*/g, " ")
    .trim()
    .slice(0, maxLength)
    .trim();
}
