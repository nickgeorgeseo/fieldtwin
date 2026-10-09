import { describe, expect, it } from "vitest";
import { createApp } from "../../../src/app.ts";
import { createCheckpoint, listChanges, loadScenario } from "../../../src/control/operations.ts";
import type { JobberState } from "../../../src/vendors/jobber/types.ts";
import type { QboState } from "../../../src/vendors/quickbooks/types.ts";
import { EVER, syncHarness } from "./harness.ts";

const MINUTE = 60_000;
type Target = ReturnType<typeof createApp>;

/** What each system holds, read straight from the twin. */
function snapshot(target: Target) {
  const jobber = target.twin.state<JobberState>("jobber");
  const qbo = target.twin.state<QboState>("quickbooks");
  const paid = [...jobber.invoices.values()].filter((invoice) => invoice.paidAt);
  const booked = (number: string) => [...qbo.invoices.values()].filter((invoice) => invoice.DocNumber === number);
  return { jobber, qbo, paid, booked };
}

describe("syncing paid Jobber invoices into QuickBooks", () => {
  it("books every paid invoice: the customer, the invoice with Balance 0, and the payment that settled it", async () => {
    const target = createApp({ seed: 42, auth: "oauth" });
    const before = snapshot(target);
    const missing = before.paid.filter((invoice) => before.booked(invoice.invoiceNumber).length === 0).length;
    const open = before.paid.filter((invoice) => before.booked(invoice.invoiceNumber)[0]?.Balance).length;
    expect(missing).toBeGreaterThan(0); // the seeded books are two weeks behind, so there is real work
    expect(open).toBeGreaterThan(0);

    const stats = await (await syncHarness(target)).sync(EVER);
    expect(stats).toMatchObject({ invoices: before.paid.length, invoicesCreated: missing, paymentsCreated: missing + open, failed: 0 });

    const after = snapshot(target);
    for (const invoice of after.paid) {
      const [booked, ...duplicates] = after.booked(invoice.invoiceNumber);
      expect(duplicates).toEqual([]);
      const client = after.jobber.clients.get(invoice.clientId)!;
      const customer = after.qbo.customers.get(booked!.CustomerRef.value)!;
      expect(customer.PrimaryEmailAddr?.Address).toBe(client.emails[0]!.address);
      expect(booked).toMatchObject({ Balance: 0, PrivateNote: `Synced from Jobber invoice #${invoice.invoiceNumber}` });
    }
    const payments = [...after.qbo.payments.values()].filter((payment) => payment.PaymentRefNum?.startsWith("JOBBER-"));
    expect(payments).toHaveLength(missing + open);
  });

  it("changes nothing when it runs again", async () => {
    const target = createApp({ seed: 42, auth: "oauth" });
    const harness = await syncHarness(target);
    await harness.sync(EVER);
    createCheckpoint(target.twin, "after-first-run");

    const again = await harness.sync(EVER);
    expect(listChanges(target.twin, "after-first-run", { onlyFromApi: true })).toEqual([]);
    expect(again).toMatchObject({ customersCreated: 0, invoicesCreated: 0, paymentsCreated: 0, invoicesStamped: 0, failed: 0 });
  });

  it("recovers from the stale SyncToken that recording a payment leaves behind", async () => {
    const target = createApp({ seed: 42, auth: "oauth" });
    const stats = await (await syncHarness(target)).sync(EVER);
    // The stamp reuses the invoice as read before the payment, whose SyncToken the payment bumped (5010).
    expect(stats.staleRetries).toBe(stats.paymentsCreated);
    expect(stats.invoicesStamped).toBe(stats.invoices);
  });

  it("picks up invoices that get paid later, on the next run", async () => {
    const target = createApp({ seed: 42, auth: "oauth" });
    const scenario = `
name: Paid this morning
seed: 42
startTime: "2026-07-13T11:00:00Z"
timeline:
  - at: "+1h"
    jobber: { payInvoices: 2 }
`;
    loadScenario(target.twin, scenario);
    const harness = await syncHarness(target);
    const firstRunAt = new Date(target.twin.clock.nowMs()).toISOString();
    await harness.sync(EVER);

    target.twin.advance(90 * MINUTE); // two invoices are paid at +1h
    const later = await harness.sync(firstRunAt);
    expect(later).toMatchObject({ invoices: 2, failed: 0 });
    expect(later.paymentsCreated).toBe(2);

    const after = snapshot(target);
    expect(after.paid.every((invoice) => after.booked(invoice.invoiceNumber)[0]?.Balance === 0)).toBe(true);
  });

  it("keeps working after two hours of twin time: both tokens refresh, and Jobber's rotated one is kept", async () => {
    const target = createApp({ seed: 42, auth: "oauth" });
    const harness = await syncHarness(target);
    await harness.sync(EVER);
    const jobberRefreshToken = harness.jobberTokens.current.refreshToken;

    target.twin.advance(120 * MINUTE);
    const later = await harness.sync(EVER);
    expect(later.failed).toBe(0);
    expect(harness.quickbooksTokens.refreshes).toBeGreaterThanOrEqual(1);
    expect(harness.jobberTokens.refreshes).toBeGreaterThanOrEqual(1);
    expect(harness.jobberTokens.current.refreshToken).not.toBe(jobberRefreshToken);
  });
});
