import { describe, expect, it } from "vitest";
import { createApp } from "../../../src/app.ts";
import type { JobberState } from "../../../src/vendors/jobber/types.ts";
import type { QboState } from "../../../src/vendors/quickbooks/types.ts";
import { InvoiceQueue } from "../src/invoice-queue.ts";
import { fetchPaidInvoicesSince } from "../src/jobber-invoices.ts";
import { OAuthError } from "../src/oauth.ts";
import { emptyStats, salesLineFor, syncPaidInvoices } from "../src/sync.ts";
import { EVER, syncHarness } from "./harness.ts";

/**
 * What happens in production that a single clean run never shows: two syncs at once, a connection lost while
 * webhooks keep coming, clocks that disagree, and line items whose arithmetic QuickBooks would refuse.
 */

describe("two syncs at the same moment", () => {
  it("book each invoice and its payment once, as the scheduled sync and a webhook's sync may", async () => {
    const target = createApp({ seed: 42, auth: "oauth" });
    const harness = await syncHarness(target);
    const clients = { jobber: harness.jobber, quickbooks: harness.quickbooks, log: harness.runtime.log };
    await Promise.all([syncPaidInvoices(clients, EVER), syncPaidInvoices(clients, EVER)]);

    const qbo = target.twin.state<QboState>("quickbooks");
    const docNumbers = [...qbo.invoices.values()].map((invoice) => invoice.DocNumber);
    expect(docNumbers.length).toBe(new Set(docNumbers).size);
    const refs = [...qbo.payments.values()].map((payment) => payment.PaymentRefNum).filter(Boolean);
    expect(refs.length).toBe(new Set(refs).size);
  });
});

describe("the webhook queue when the connection is lost", () => {
  const update = (itemId: string) => ({ topic: "INVOICE_UPDATE", appId: "app", accountId: "account", itemId, occurredAt: "now" });

  it("stops, keeps what it hadn't synced, never rejects, and carries on once the app is connected again", async () => {
    let connected = false;
    const tried: string[] = [];
    const lines: string[] = [];
    const queue = new InvoiceQueue(
      async (invoiceId) => {
        tried.push(invoiceId);
        if (!connected) throw new OAuthError("The refresh token was revoked. Reconnect the app.", 400, "invalid_grant");
        return { ...emptyStats(), invoices: 1 };
      },
      (line) => lines.push(line),
    );

    queue.add(update("A"));
    await expect(queue.idle()).resolves.toBeUndefined();
    expect(queue.connectionLost).toBeInstanceOf(OAuthError);
    expect(lines.join("\n")).toContain("Reconnect the app");

    queue.add(update("B")); // news keeps coming while nobody has reconnected: kept, not tried
    await queue.idle();
    expect(tried).toEqual(["A"]);

    connected = true;
    queue.resume();
    await queue.idle();
    expect(tried).toEqual(["A", "A", "B"]);
    expect(queue.connectionLost).toBeUndefined();
    expect(queue.totals.invoices).toBe(2);
  });
});

describe("the scheduled sync's cutoff", () => {
  it("reads again what changed in the minutes before `since`, so clocks that disagree can't hide an invoice", async () => {
    const target = createApp({ seed: 42, auth: "oauth" });
    const harness = await syncHarness(target);
    const paid = [...target.twin.state<JobberState>("jobber").invoices.values()].find((invoice) => invoice.paidAt)!;
    const updatedAt = Date.parse(paid.updatedAt);
    for (const since of [updatedAt, updatedAt + 5 * 60_000]) {
      const found = await fetchPaidInvoicesSince(harness.jobber, new Date(since).toISOString());
      expect(found.map((invoice) => invoice.invoiceNumber)).toContain(String(paid.invoiceNumber));
    }
  });
});

describe("a Jobber line whose quantity times price isn't its total", () => {
  it("is booked at its total, without the Qty and UnitPrice QuickBooks would refuse with 6070", () => {
    const line = { name: "Panel inspection", description: null, quantity: 3, unitPrice: 33.33, totalPrice: 100 }; // 3 × 33.33 is 99.99
    expect(salesLineFor(line, "7")).toEqual({
      DetailType: "SalesItemLineDetail",
      Amount: 100,
      Description: "Panel inspection (3 × 33.33)",
      SalesItemLineDetail: { ItemRef: { value: "7" } },
    });
  });

  it("keeps Qty and UnitPrice when they agree with the total, to the cent", () => {
    const line = { name: "Labor", description: "Two and a half hours", quantity: 2.5, unitPrice: 33.33, totalPrice: 83.33 };
    expect(salesLineFor(line, "1").SalesItemLineDetail).toEqual({ ItemRef: { value: "1" }, Qty: 2.5, UnitPrice: 33.33 });
  });
});
