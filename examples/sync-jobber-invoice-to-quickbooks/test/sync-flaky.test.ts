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

    // And the faults really happened. (Jobber's 5% bad gateway rarely meets a sync's few Jobber requests;
    // jobber.test.ts covers it.)
    const retried = (pattern: RegExp) => harness.lines.filter((line) => pattern.test(line)).length;
    expect(retried(/^QuickBooks .*: HTTP 429, retrying in 60s/)).toBeGreaterThan(0);
    expect(retried(/^QuickBooks .*: HTTP 503, retrying/)).toBeGreaterThan(0);
    expect(retried(/^Jobber: HTTP 429, retrying/)).toBeGreaterThan(0);
    // Sixty-second waits add up: the run outlives its first access tokens, and refreshes them on the way.
    expect(harness.quickbooksTokens.refreshes).toBeGreaterThan(0);
  });
});
