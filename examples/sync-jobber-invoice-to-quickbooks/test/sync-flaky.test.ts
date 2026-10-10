import { describe, expect, it } from "vitest";
import { createApp } from "../../../src/app.ts";
import { loadScenarioByName } from "../../../src/control/operations.ts";
import type { QboState } from "../../../src/vendors/quickbooks/types.ts";
import type { SyncStats } from "../src/sync.ts";
import { EVER, syncHarness } from "./harness.ts";

type Target = ReturnType<typeof createApp>;
type Harness = Awaited<ReturnType<typeof syncHarness>>;

/**
 * Production runs a sync on a schedule, so a run that gave up on an invoice is finished by a later one.
 * Run until a run fails nothing and has nothing left to do, at most five times.
 */
async function syncUntilSettled(harness: Harness) {
  const runs: (SyncStats | { error: string })[] = [];
  for (let run = 1; run <= 5; run++) {
    const stats = await harness.sync(EVER).catch((error: Error) => ({ error: error.message }));
    runs.push(stats);
    if ("error" in stats || stats.failed > 0) continue;
    if (stats.customersCreated + stats.invoicesCreated + stats.paymentsCreated + stats.invoicesStamped === 0) break;
  }
  return runs;
}

/** What a person would check in the books, without Ids or times, which depend on the order the work happened in. */
function books(target: Target) {
  const qbo = target.twin.state<QboState>("quickbooks");
  const customerName = (id: string) => qbo.customers.get(id)!.DisplayName;
  const docNumber = (id: string) => qbo.invoices.get(id)!.DocNumber;
  const byKey = <T>(items: T[]) => items.map((item) => JSON.stringify(item)).sort();
  return {
    customers: byKey([...qbo.customers.values()].map((customer) => [customer.DisplayName, customer.PrimaryEmailAddr?.Address])),
    invoices: byKey(
      [...qbo.invoices.values()].map((invoice) => ({
        DocNumber: invoice.DocNumber,
        customer: customerName(invoice.CustomerRef.value),
        TotalAmt: invoice.TotalAmt,
        Balance: invoice.Balance,
        PrivateNote: invoice.PrivateNote ?? null,
        lines: invoice.Line.map((line) => [line.DetailType, line.Amount]),
      })),
    ),
    payments: byKey(
      [...qbo.payments.values()].map((payment) => ({
        PaymentRefNum: payment.PaymentRefNum ?? null,
        customer: customerName(payment.CustomerRef.value),
        TotalAmt: payment.TotalAmt,
        invoices: payment.Line.map((line) => docNumber(line.LinkedTxn[0]!.TxnId)),
      })),
    ),
  };
}

describe("syncing through flaky APIs (flaky-apis)", () => {
  it("ends with the same books as a clean run, however often the APIs fail on the way", async () => {
    const flaky = createApp({ seed: 42 });
    loadScenarioByName(flaky.twin, "flaky-apis");
    const harness = await syncHarness(flaky);
    const runs = await syncUntilSettled(harness);
    expect(runs.length).toBeLessThan(5); // it settled

    // The same world at the same twin time (so the timeline's payments have happened too), with no faults.
    const clean = createApp({ seed: 42 });
    loadScenarioByName(clean.twin, "flaky-apis");
    clean.twin.faultRules = [];
    clean.twin.advance(flaky.twin.clock.nowMs() - clean.twin.clock.nowMs());
    const cleanStats = await (await syncHarness(clean)).sync(EVER);
    expect(cleanStats.failed).toBe(0);

    expect(books(flaky)).toEqual(books(clean));

    // And the QuickBooks faults really happened, lost answers included: those writes were made, retried, and
    // answered from their requestid instead of being made twice. (A sync sends Jobber only a few requests, so its
    // faults may not meet them; jobber.test.ts covers those.)
    const retried = (pattern: RegExp) => harness.lines.filter((line) => pattern.test(line)).length;
    expect(retried(/^QuickBooks .*: HTTP 429, retrying in 60s/)).toBeGreaterThan(0);
    expect(retried(/^QuickBooks .*: HTTP 503, retrying/)).toBeGreaterThan(0);
    expect(retried(/^QuickBooks POST .*: HTTP 504, retrying/)).toBeGreaterThan(0);
    // Sixty-second waits add up: the run outlives its first access tokens, and refreshes them on the way.
    expect(harness.quickbooksTokens.refreshes).toBeGreaterThan(0);
  });

  it("makes each invoice once when every answer to it is lost, where a client without requestids makes eight", async () => {
    const copiesOfEachInvoice = async (requestIds: boolean) => {
      const target = createApp({ seed: 42, auth: "oauth" });
      target.twin.faultRules = [
        {
          name: "lost",
          vendor: "quickbooks",
          method: "POST",
          pathIncludes: "/invoice",
          rate: 1,
          effect: { status: 504, lostResponse: true },
        },
      ];
      await (await syncHarness(target, { requestIds })).sync(EVER);
      const copies = new Map<string, number>();
      for (const invoice of target.twin.state<QboState>("quickbooks").invoices.values()) {
        copies.set(invoice.DocNumber!, (copies.get(invoice.DocNumber!) ?? 0) + 1);
      }
      return Math.max(...copies.values());
    };
    expect(await copiesOfEachInvoice(true)).toBe(1);
    expect(await copiesOfEachInvoice(false)).toBe(8); // every one of the client's eight attempts made another
  });
});
