import { describe, expect, it } from "vitest";
import { createApp } from "../../../src/app.ts";
import type { QboState } from "../../../src/vendors/quickbooks/types.ts";
import { createQuickBooksClient, QuickBooksError, quoted } from "../src/quickbooks.ts";
import * as books from "../src/quickbooks-entities.ts";
import type { Runtime } from "../src/runtime.ts";
import { connectBoth, ENDPOINTS } from "./harness.ts";

/** A connected client. `intercept` can answer a request itself (return a Response) or let it through (undefined). */
async function connected(intercept: (url: string, init?: RequestInit) => Response | undefined = () => undefined) {
  const target = createApp({ seed: 42, auth: "oauth" });
  const connection = await connectBoth(target);
  const urls: string[] = [];
  const runtime: Runtime = {
    ...connection.runtime,
    fetch: async (url, init) => {
      urls.push(`${init?.method ?? "GET"} ${url}`);
      return intercept(url, init) ?? connection.runtime.fetch(url, init);
    },
  };
  const qbo = createQuickBooksClient({
    apiBase: ENDPOINTS.quickbooks.apiBase,
    realmId: connection.realmId,
    tokens: connection.quickbooksTokens,
    runtime,
  });
  const state = () => target.twin.state<QboState>("quickbooks");
  return { target, qbo, urls, state, lines: connection.lines, tokens: connection.quickbooksTokens };
}

const fault = (status: number, code: string, message: string) =>
  new Response(JSON.stringify({ Fault: { Error: [{ Message: message, Detail: message, code }], type: "SERVICE" } }), { status });

/** Answers the first matching request with `response`, then lets everything through. */
function once(match: (url: string, init?: RequestInit) => boolean, response: () => Response) {
  let used = false;
  return (url: string, init?: RequestInit) => {
    if (used || !match(url, init)) return undefined;
    used = true;
    return response();
  };
}

describe("the QuickBooks client", () => {
  it("quotes query values, escaping apostrophes the documented way", () => {
    expect(quoted("O'Brien's Plumbing")).toBe("'O\\'Brien\\'s Plumbing'");
  });

  it("finds a customer by email, even one with an apostrophe in it", async () => {
    const { qbo, state } = await connected();
    const seeded = [...state().customers.values()][3]!;
    expect((await books.findCustomerByEmail(qbo, seeded.PrimaryEmailAddr!.Address))?.Id).toBe(seeded.Id);

    const created = await books.createCustomer(qbo, {
      DisplayName: "Pat O'Brien",
      PrimaryEmailAddr: { Address: "pat.o'brien@example.com" },
    });
    expect((await books.findCustomerByEmail(qbo, "pat.o'brien@example.com"))?.Id).toBe(created.Id);
    expect(await books.findCustomerByEmail(qbo, "nobody@example.com")).toBeUndefined();
  });

  it("creates a customer whose name is taken (6240) as 'Name (email)'", async () => {
    const { qbo } = await connected();
    await books.createCustomer(qbo, { DisplayName: "Sam Example", PrimaryEmailAddr: { Address: "sam.one@example.com" } });
    const second = await books.createCustomer(qbo, { DisplayName: "Sam Example", PrimaryEmailAddr: { Address: "sam.two@example.com" } });
    expect(second.DisplayName).toBe("Sam Example (sam.two@example.com)");
  });

  it("finds an item by name, and falls back to the first Service item with a warning", async () => {
    const { qbo, state, lines } = await connected();
    const service = [...state().items.values()].find((item) => item.Type === "Service")!;
    const part = [...state().items.values()].find((item) => item.Type === "NonInventory")!;
    expect((await books.itemForLine(qbo, part.Name, (line) => lines.push(line))).Id).toBe(part.Id);
    expect((await books.itemForLine(qbo, "Flux capacitor", (line) => lines.push(line))).Id).toBe(service.Id);
    expect(lines.at(-1)).toBe(`No QuickBooks Item named "Flux capacitor"; booking the line to "${service.Name}" instead.`);
  });

  it("creates an invoice, finds it by DocNumber, and stamps it with a sparse update", async () => {
    const { qbo, state } = await connected();
    const customer = [...state().customers.values()][0]!;
    const item = [...state().items.values()][0]!;
    const created = await books.createInvoice(qbo, {
      CustomerRef: { value: customer.Id },
      DocNumber: "T-100",
      Line: [
        { DetailType: "SalesItemLineDetail", Amount: 200, SalesItemLineDetail: { ItemRef: { value: item.Id }, Qty: 2, UnitPrice: 100 } },
      ],
    });
    expect((await books.findInvoiceByDocNumber(qbo, "T-100"))?.Id).toBe(created.Id);

    const stamped = await books.updateInvoice(qbo, { Id: created.Id, SyncToken: created.SyncToken, PrivateNote: "Synced" });
    expect(stamped.PrivateNote).toBe("Synced");
    expect(stamped.TotalAmt).toBe(200); // sparse: the lines survived
    expect((await books.readInvoice(qbo, created.Id)).SyncToken).toBe(stamped.SyncToken);
  });

  it("records a payment against an invoice and finds it by PaymentRefNum", async () => {
    const { qbo, state } = await connected();
    const open = [...state().invoices.values()].find((invoice) => invoice.Balance > 0)!;
    await books.createPayment(qbo, {
      CustomerRef: open.CustomerRef,
      TotalAmt: open.Balance,
      PaymentRefNum: "JOBBER-T1",
      Line: [{ Amount: open.Balance, LinkedTxn: [{ TxnId: open.Id, TxnType: "Invoice" }] }],
    });
    expect((await books.findPaymentByRef(qbo, "JOBBER-T1"))?.TotalAmt).toBe(open.Balance);
    expect((await books.readInvoice(qbo, open.Id)).Balance).toBe(0);
  });

  it("turns a QuickBooks Fault into a QuickBooksError with the status, code, and Detail", async () => {
    const { qbo, state } = await connected();
    const invoice = [...state().invoices.values()][0]!;
    const failure = await books.updateInvoice(qbo, { Id: invoice.Id, SyncToken: "99", PrivateNote: "x" }).catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(QuickBooksError);
    expect(failure).toMatchObject({ status: 400, code: "5010", message: expect.stringContaining("Stale Object") });
  });

  it("waits the documented 60 seconds after a 429 before trying again", async () => {
    const throttle = once(
      () => true,
      () => fault(429, "003001", "ThrottleExceeded"),
    );
    const { target, qbo, lines } = await connected(throttle);
    const before = target.twin.clock.nowMs();
    await books.findCustomerByEmail(qbo, "nobody@example.com");
    expect(target.twin.clock.nowMs() - before).toBe(60_000);
    expect(lines).toContain("QuickBooks GET /query: HTTP 429, retrying in 60s (attempt 2 of 8)");
  });

  it("sends a requestid made from the write with every write, and the same one when it retries that write", async () => {
    const unavailable = once(
      (_, init) => init?.method === "POST",
      () => fault(503, "10000", "Service unavailable"),
    );
    const { qbo, urls } = await connected(unavailable);
    await books.createCustomer(qbo, { DisplayName: "Robin Retry", PrimaryEmailAddr: { Address: "robin@example.com" } });
    const writes = urls.filter((url) => url.startsWith("POST") && url.includes("/customer"));
    expect(writes).toHaveLength(2);
    const ids = writes.map((url) => new URL(url.slice("POST ".length)).searchParams.get("requestid"));
    expect(ids[0]).toMatch(/^[0-9a-f]{40}$/);
    expect(ids[1]).toBe(ids[0]);
  });

  it("refreshes the token once when QuickBooks answers 401, then retries", async () => {
    const expired = once(
      (url) => url.includes("/v3/"),
      () => fault(401, "3200", "ApplicationAuthenticationFailed"),
    );
    const { qbo, target, tokens } = await connected(expired);
    expect(await books.findCustomerByEmail(qbo, "nobody@example.com")).toBeUndefined();
    expect(tokens.refreshes).toBe(1);
    expect(target.twin.clock.nowMs()).toBe(Date.parse("2026-07-13T11:00:00Z")); // no backoff: a 401 isn't retried blindly
  });
});
