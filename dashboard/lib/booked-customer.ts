import type { QboCustomer } from "./books.ts";

/**
 * The QuickBooks customer the reference integration books a field-service customer's invoices for, found the way it
 * finds one (examples/sync-jobber-invoice-to-quickbooks/src/sync-customers.ts): by email, or by name for a customer
 * with no email, the name compared without regard to case as QuickBooks queries compare it. Among several, an active
 * one wins, as the sync's activeFirst picks. One customer can be found for two field-service customers, since the
 * sync finds the same one for two clients under one email.
 */
export function bookedCustomer(customer: { name: string; email: string }, books: QboCustomer[]): QboCustomer | undefined {
  const email = customer.email.trim().toLowerCase();
  const name = bookName(customer.name).toLowerCase();
  const found = books.filter((booked) =>
    email ? booked.PrimaryEmailAddr?.Address?.trim().toLowerCase() === email : booked.DisplayName.trim().toLowerCase() === name,
  );
  return found.find((booked) => booked.Active !== false) ?? found[0];
}

/**
 * A name as the sync books it: QuickBooks refuses a colon, tab, or newline in a customer's name (2040, Invalid
 * String, https://developer.intuit.com/app/developer/qbo/docs/api/accounting/all-entities/customer), so the sync
 * books a colon as a dash and a line break as a space, and looks the customer up under that name.
 */
function bookName(name: string): string {
  return name
    .replace(/\s*:\s*/g, " - ")
    .replace(/\s*[\t\r\n]\s*/g, " ")
    .trim();
}
