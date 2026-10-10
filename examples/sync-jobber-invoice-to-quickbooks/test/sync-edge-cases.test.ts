import { describe, expect, it } from "vitest";
import { createApp } from "../../../src/app.ts";
import type { JobberState } from "../../../src/vendors/jobber/types.ts";
import type { QboState } from "../../../src/vendors/quickbooks/types.ts";
import * as books from "../src/quickbooks-entities.ts";
import { EVER, syncHarness } from "./harness.ts";

function twinWithBooks() {
  const target = createApp({ seed: 42, auth: "oauth" });
  const jobber = () => target.twin.state<JobberState>("jobber");
  const qbo = () => target.twin.state<QboState>("quickbooks");
  const booked = (number: string) => [...qbo().invoices.values()].filter((invoice) => invoice.DocNumber === number);
  const firstPaidMissingFromBooks = () =>
    [...jobber().invoices.values()].find((invoice) => invoice.paidAt && !booked(invoice.invoiceNumber).length)!;
  return { target, jobber, qbo, booked, firstPaidMissingFromBooks };
}

describe("syncing, where the books need a person's judgment", () => {
  it("leaves an invoice number that QuickBooks already uses for another customer alone, and says so", async () => {
    const { target, jobber, qbo, booked, firstPaidMissingFromBooks } = twinWithBooks();
    const harness = await syncHarness(target);
    const invoice = firstPaidMissingFromBooks();
    const ownerEmail = jobber().clients.get(invoice.clientId)!.emails[0]!.address;
    const someoneElse = [...qbo().customers.values()].find((customer) => customer.PrimaryEmailAddr?.Address !== ownerEmail)!;
    const item = [...qbo().items.values()][0]!;
    const theirs = await books.createInvoice(harness.quickbooks, {
      CustomerRef: { value: someoneElse.Id },
      DocNumber: invoice.invoiceNumber,
      Line: [{ DetailType: "SalesItemLineDetail", Amount: 50, SalesItemLineDetail: { ItemRef: { value: item.Id } } }],
    });

    const stats = await harness.sync(EVER);
    expect(stats).toMatchObject({ conflicts: 1, failed: 0 });
    expect(booked(invoice.invoiceNumber)).toEqual([expect.objectContaining({ Id: theirs.Id, SyncToken: theirs.SyncToken, Balance: 50 })]);
    const warning = harness.lines.find((line) => line.startsWith(`Invoice #${invoice.invoiceNumber}: QuickBooks already has that number`));
    expect(warning).toContain("check it by hand");
  });

  it("books new work for a customer the bookkeeper made inactive by making them active again, not by creating a duplicate", async () => {
    const { target, jobber, qbo, booked, firstPaidMissingFromBooks } = twinWithBooks();
    const harness = await syncHarness(target);
    const invoice = firstPaidMissingFromBooks();
    const email = jobber().clients.get(invoice.clientId)!.emails[0]!.address;
    const customer = [...qbo().customers.values()].find((candidate) => candidate.PrimaryEmailAddr?.Address === email)!;
    await harness.quickbooks.write("Customer", { Id: customer.Id, SyncToken: customer.SyncToken, sparse: true, Active: false });
    const customersBefore = qbo().customers.size;

    const stats = await harness.sync(EVER);
    expect(stats).toMatchObject({ customersCreated: 0, customersReactivated: 1, conflicts: 0, failed: 0 });
    expect(qbo().customers.size).toBe(customersBefore);
    expect(booked(invoice.invoiceNumber)).toEqual([
      expect.objectContaining({ CustomerRef: expect.objectContaining({ value: customer.Id }) }),
    ]);
    expect(qbo().customers.get(customer.Id)!.Active).toBe(true);
    const reactivated = `Customer "${customer.DisplayName}" was inactive in QuickBooks; made active again to book Jobber invoice #`;
    expect(harness.lines.filter((line) => line.startsWith(reactivated))).toHaveLength(1); // once, for their first new work
  });

  it("leaves a customer the bookkeeper made inactive as they are when all their work is already in the books", async () => {
    const { target, jobber, qbo, booked } = twinWithBooks();
    const harness = await syncHarness(target);
    const settledInBooks = (clientId: string) => {
      const paid = [...jobber().invoices.values()].filter((invoice) => invoice.clientId === clientId && invoice.paidAt);
      return paid.length > 0 && paid.every((invoice) => booked(invoice.invoiceNumber).some((entry) => entry.Balance === 0));
    };
    const client = [...jobber().clients.values()].find((candidate) => settledInBooks(candidate.id))!;
    const customer = [...qbo().customers.values()].find((candidate) => candidate.PrimaryEmailAddr?.Address === client.emails[0]!.address)!;
    await harness.quickbooks.write("Customer", { Id: customer.Id, SyncToken: customer.SyncToken, sparse: true, Active: false });
    const customersBefore = qbo().customers.size;

    const stats = await harness.sync(EVER);
    expect(stats).toMatchObject({ customersCreated: 0, customersReactivated: 0, conflicts: 0, failed: 0 });
    expect(qbo().customers.size).toBe(customersBefore);
    expect(qbo().customers.get(customer.Id)!.Active).toBe(false);
  });

  it("matches a client Jobber has no email for by exact name", async () => {
    const { target, jobber, qbo, booked, firstPaidMissingFromBooks } = twinWithBooks();
    const invoice = firstPaidMissingFromBooks();
    const client = jobber().clients.get(invoice.clientId)!;
    target.twin.record({ vendor: "jobber", type: "ClientCreated", data: { client: { ...client, emails: [] } } }, "control");
    const customersBefore = qbo().customers.size;

    const stats = await (await syncHarness(target)).sync(EVER);
    expect(stats).toMatchObject({ customersCreated: 0, failed: 0 });
    expect(qbo().customers.size).toBe(customersBefore);
    const customer = qbo().customers.get(booked(invoice.invoiceNumber)[0]!.CustomerRef.value)!;
    expect(customer.DisplayName).toBe(`${client.firstName} ${client.lastName}`);
  });
});
