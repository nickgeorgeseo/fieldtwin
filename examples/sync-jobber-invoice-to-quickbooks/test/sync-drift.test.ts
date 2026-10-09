import { describe, expect, it } from "vitest";
import { createApp } from "../../../src/app.ts";
import { loadScenarioByName } from "../../../src/control/operations.ts";
import type { JobberState } from "../../../src/vendors/jobber/types.ts";
import type { QboState } from "../../../src/vendors/quickbooks/types.ts";
import { EVER, syncHarness } from "./harness.ts";

/** mismatched-books: three customers respelled in QuickBooks (same email), two only in Jobber, two only in QuickBooks. */
async function syncedMismatchedBooks() {
  const target = createApp({ seed: 42, auth: "oauth" });
  loadScenarioByName(target.twin, "mismatched-books");
  const harness = await syncHarness(target);
  const stats = await harness.sync(EVER);

  const { world } = target.twin;
  const jobber = target.twin.state<JobberState>("jobber");
  const qbo = target.twin.state<QboState>("quickbooks");
  const person = (key: string) => world.customers.find((customer) => customer.key === key)!;
  const customersWithEmail = (email: string) =>
    [...qbo.customers.values()].filter((customer) => customer.PrimaryEmailAddr?.Address === email);
  const paidInvoicesOf = (email: string) => {
    const client = [...jobber.clients.values()].find((candidate) => candidate.emails[0]?.address === email)!;
    return [...jobber.invoices.values()].filter((invoice) => invoice.clientId === client.id && invoice.paidAt);
  };
  const bookedTo = (invoiceNumber: string) =>
    [...qbo.invoices.values()].find((invoice) => invoice.DocNumber === invoiceNumber)?.CustomerRef.value;
  return { stats, lines: harness.lines, world, qbo, person, customersWithEmail, paidInvoicesOf, bookedTo };
}

describe("syncing books that have drifted from the field (mismatched-books)", () => {
  it("matches customers the books spell differently by email, without renaming them or adding duplicates", async () => {
    const { stats, lines, world, person, customersWithEmail, paidInvoicesOf, bookedTo } = await syncedMismatchedBooks();
    const respelled = Object.entries(world.drift.accountingSpellings).map(([key, spelling]) => ({ ...person(key), spelling }));
    const withPaidWork = respelled.filter((customer) => paidInvoicesOf(customer.email).length > 0);
    expect(withPaidWork.length).toBeGreaterThan(0);
    expect(stats.customersSpelledDifferently).toBe(withPaidWork.length);

    for (const customer of respelled) {
      const [inBooks, ...duplicates] = customersWithEmail(customer.email);
      expect(duplicates).toEqual([]);
      expect(inBooks!.DisplayName).toBe(`${customer.spelling.firstName} ${customer.spelling.lastName}`); // not renamed
    }
    for (const customer of withPaidWork) {
      const inBooks = customersWithEmail(customer.email)[0]!;
      expect(lines).toContain(
        `Customer "${customer.firstName} ${customer.lastName}" is "${inBooks.DisplayName}" in QuickBooks (same email). Matched, and left as the books have it.`,
      );
      for (const invoice of paidInvoicesOf(customer.email)) expect(bookedTo(invoice.invoiceNumber)).toBe(inBooks.Id);
    }
  });

  it("creates the customers QuickBooks has never seen, and books their paid invoices to them", async () => {
    const { stats, world, person, customersWithEmail, paidInvoicesOf, bookedTo } = await syncedMismatchedBooks();
    const fieldOnly = world.drift.fieldServiceOnly.map(person).filter((customer) => paidInvoicesOf(customer.email).length > 0);
    expect(fieldOnly.length).toBeGreaterThan(0);
    expect(stats.customersCreated).toBe(fieldOnly.length);

    for (const customer of fieldOnly) {
      const [created, ...duplicates] = customersWithEmail(customer.email);
      expect(duplicates).toEqual([]);
      expect(created!.DisplayName).toBe(`${customer.firstName} ${customer.lastName}`);
      for (const invoice of paidInvoicesOf(customer.email)) expect(bookedTo(invoice.invoiceNumber)).toBe(created!.Id);
    }
  });

  it("leaves no two QuickBooks customers sharing an email address", async () => {
    const { stats, qbo } = await syncedMismatchedBooks();
    expect(stats.failed).toBe(0);
    const emails = [...qbo.customers.values()].map((customer) => customer.PrimaryEmailAddr?.Address);
    expect(new Set(emails).size).toBe(emails.length);
  });
});
