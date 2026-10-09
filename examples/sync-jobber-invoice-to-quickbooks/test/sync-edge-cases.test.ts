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
