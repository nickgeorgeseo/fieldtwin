import { describe, expect, it } from "vitest";
import { createApp } from "../../../src/app.ts";
import type { JobberState } from "../../../src/vendors/jobber/types.ts";
import { fetchPaidInvoicesSince } from "../src/jobber-invoices.ts";
import { salesLineFor } from "../src/sync.ts";
import { syncHarness } from "./harness.ts";

/**
 * What happens in production that a single clean run never shows: clocks that disagree, and line items whose arithmetic QuickBooks would refuse.
 */

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
