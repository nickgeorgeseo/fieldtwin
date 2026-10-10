import type { JobberInvoiceClient } from "./jobber-invoices.ts";
import * as books from "./quickbooks-entities.ts";
import type { SyncContext } from "./sync.ts";

/**
 * The QuickBooks customer for a Jobber client.
 *
 * Match by email first: names drift between systems (typos, alternate spellings, "Bob" for "Robert"), while the
 * email address stays the same. A customer the books spell differently is matched and left alone, because the
 * books belong to the bookkeeper; the sync only says so in the log. Only a client with no email is matched by
 * exact name. Anyone not found is created, so customers who exist only in Jobber reach the books. Customers the
 * bookkeeper made inactive are found too, and stay inactive until a write needs them (ensureActive).
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
  const found = email ? await books.findCustomerByEmail(quickbooks, email) : await books.findCustomerByName(quickbooks, client.name);
  if (found && found.DisplayName !== client.name) {
    stats.customersSpelledDifferently++;
    log(`Customer "${client.name}" is "${found.DisplayName}" in QuickBooks (same email). Matched, and left as the books have it.`);
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
    DisplayName: client.name,
    ...(client.firstName && { GivenName: client.firstName }),
    ...(client.lastName && { FamilyName: client.lastName }),
    ...(client.companyName && { CompanyName: client.companyName }),
    ...(email && { PrimaryEmailAddr: { Address: email } }),
  });
  stats.customersCreated++;
  log(`Created customer "${customer.DisplayName}" in QuickBooks.`);
  return customer;
}
