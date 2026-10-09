import type { JobberInvoiceClient } from "./jobber-invoices.ts";
import * as books from "./quickbooks-entities.ts";
import type { SyncContext } from "./sync.ts";

/**
 * The QuickBooks customer for a Jobber client.
 *
 * Match by email first: names drift between systems (typos, alternate spellings, "Bob" for "Robert"), while the
 * email address stays the same. A customer the books spell differently is matched and left alone, because the
 * books belong to the bookkeeper; the sync only says so in the log. Only a client with no email is matched by
 * exact name. Anyone not found is created, so customers who exist only in Jobber reach the books.
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
