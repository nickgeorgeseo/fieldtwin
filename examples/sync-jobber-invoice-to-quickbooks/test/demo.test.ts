import { describe, expect, it } from "vitest";
import { createApp } from "../../../src/app.ts";
import { runDemo } from "../src/main.ts";
import { TWIN_URL } from "./harness.ts";

describe("the demo (npm run example:sync)", () => {
  it("connects, syncs, sleeps two hours of twin time over the control plane, and syncs again", async () => {
    const target = createApp({ seed: 42, auth: "oauth" });
    const lines: string[] = [];
    const startMs = target.twin.clock.nowMs();
    const { first, second } = await runDemo(
      TWIN_URL,
      (line) => lines.push(line),
      async (url, init) => target.app.request(url, init),
    );

    expect(first).toMatchObject({ invoices: 26, invoicesCreated: 2, paymentsCreated: 8, failed: 0 });
    expect(second).toMatchObject({ invoices: 0, failed: 0 });
    expect(target.twin.clock.nowMs() - startMs).toBe(2 * 3_600_000);
    expect(lines[0]).toBe(`Connected to QuickBooks (company 9341000000000001) and Jobber at ${TWIN_URL}.`);
    expect(lines).toContain(
      "  26 paid invoices: 2 booked, 8 payments recorded, 26 stamped, 0 customers created, 0 matched despite a different spelling, 8 stale SyncTokens recovered, 0 conflicts, 0 failed.",
    );
  });
});
