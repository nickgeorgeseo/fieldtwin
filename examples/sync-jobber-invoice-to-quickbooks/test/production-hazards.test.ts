import { describe, expect, it } from "vitest";
import { createApp } from "../../../src/app.ts";
import type { JobberState } from "../../../src/vendors/jobber/types.ts";
import type { QboState } from "../../../src/vendors/quickbooks/types.ts";
import { InvoiceQueue } from "../src/invoice-queue.ts";
import { fetchPaidInvoicesSince } from "../src/jobber-invoices.ts";
import { TokenManager } from "../src/oauth.ts";
import { createQuickBooksClient } from "../src/quickbooks.ts";
import { emptyStats, salesLineFor, syncPaidInvoices } from "../src/sync.ts";
import { OAuthError, TokenEndpointError } from "../src/token-endpoint.ts";
import { ENDPOINTS, EVER, QUICKBOOKS_APP, syncHarness } from "./harness.ts";

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

describe("a token endpoint that is down", () => {
  it("stops the scheduled run, since nothing else would work either, instead of failing every invoice in turn", async () => {
    const target = createApp({ seed: 42, auth: "oauth" });
    const harness = await syncHarness(target);
    target.twin.advance(2 * 3_600_000); // the access tokens have expired
    let tokenRequests = 0;
    const runtime = {
      ...harness.runtime,
      fetch: async (url: string, init?: RequestInit) => {
        if (url !== ENDPOINTS.quickbooks.tokenUrl) return harness.runtime.fetch(url, init);
        tokenRequests++;
        return new Response("Service Unavailable", { status: 503 }); // QuickBooks' token endpoint is down
      },
    };
    const tokens = new TokenManager(
      { ...QUICKBOOKS_APP, tokenUrl: ENDPOINTS.quickbooks.tokenUrl },
      harness.quickbooksTokens.current,
      runtime,
    );
    const quickbooks = createQuickBooksClient({ apiBase: ENDPOINTS.quickbooks.apiBase, realmId: harness.realmId, tokens, runtime });

    await expect(syncPaidInvoices({ jobber: harness.jobber, quickbooks, log: () => {} }, EVER)).rejects.toBeInstanceOf(TokenEndpointError);
    expect(tokenRequests).toBe(4); // one refresh, retried, for the first invoice; none for the rest
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

  it("remembers the latest 10,000 invoices it synced, so a server that runs for months doesn't grow without end", async () => {
    const queue = new InvoiceQueue(
      async () => ({ ...emptyStats(), invoices: 1 }),
      () => {},
    );
    for (let n = 1; n <= 10_001; n++) queue.add(update(`invoice-${n}`));
    await queue.idle();
    expect(queue.totals.invoices).toBe(10_001);

    queue.add(update("invoice-10001")); // remembered: the same invoice again
    queue.add(update("invoice-1")); // the oldest, forgotten: counted again
    await queue.idle();
    expect(queue.totals.invoices).toBe(10_002);
  });

  it("keeps the invoice it was syncing first in line, so news is still synced in the order it came", async () => {
    let connected = false;
    const tried: string[] = [];
    const queue = new InvoiceQueue(
      async (invoiceId) => {
        tried.push(invoiceId);
        if (!connected) throw new OAuthError("The refresh token was revoked. Reconnect the app.", 400, "invalid_grant");
        return { ...emptyStats(), invoices: 1 };
      },
      () => {},
    );
    for (const id of ["A", "B", "C"]) queue.add(update(id));
    await queue.idle();

    connected = true;
    queue.resume();
    await queue.idle();
    expect(tried).toEqual(["A", "A", "B", "C"]);
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
