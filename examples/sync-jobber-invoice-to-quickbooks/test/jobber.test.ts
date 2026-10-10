import { describe, expect, it } from "vitest";
import { createApp } from "../../../src/app.ts";
import { LeakyBucket } from "../../../src/core/leaky-bucket.ts";
import { COST_LIMITS } from "../../../src/vendors/jobber/cost.ts";
import type { JobberState } from "../../../src/vendors/jobber/types.ts";
import { createJobberClient, JobberError } from "../src/jobber.ts";
import { fetchPaidInvoicesSince } from "../src/jobber-invoices.ts";
import { TokenManager } from "../src/oauth.ts";
import { connectBoth, ENDPOINTS, JOBBER_APP } from "./harness.ts";

const HOUR = 3_600_000;
const SINCE = "2026-06-01T00:00:00Z";

async function connected() {
  const target = createApp({ seed: 42, auth: "oauth" });
  const connection = await connectBoth(target);
  const jobber = createJobberClient({ apiUrl: ENDPOINTS.jobber.apiUrl, tokens: connection.jobberTokens, runtime: connection.runtime });
  return { target, jobber, ...connection };
}

/** What the twin itself says: paid invoices updated after `since`, by number. */
function paidSince(target: ReturnType<typeof createApp>, since: string) {
  const invoices = [...target.twin.state<JobberState>("jobber").invoices.values()];
  return invoices
    .filter((invoice) => invoice.paidAt && invoice.updatedAt > new Date(since).toISOString())
    .map((invoice) => invoice.invoiceNumber);
}

describe("the Jobber client", () => {
  it("pages through every invoice and keeps the paid ones updated since a time, with client and line items", async () => {
    const { target, jobber } = await connected();
    const invoices = await fetchPaidInvoicesSince(jobber, SINCE);
    expect(invoices.map((invoice) => invoice.invoiceNumber)).toEqual(paidSince(target, SINCE));
    expect(invoices.length).toBeGreaterThan(0);

    const [first] = invoices;
    expect(first!.amounts.paymentsTotal).toBe(first!.amounts.total);
    expect(first!.client.email).toMatch(/@example\.com$/);
    expect(first!.lineItems.reduce((sum, line) => sum + line.totalPrice, 0)).toBeCloseTo(first!.amounts.total);
  });

  it("follows invoices and line items onto later pages", async () => {
    const { jobber } = await connected();
    const byDefault = await fetchPaidInvoicesSince(jobber, SINCE);
    const tiny = await fetchPaidInvoicesSince(jobber, SINCE, { invoices: 4, lineItems: 1 });
    expect(tiny).toEqual(byDefault);
    expect(byDefault.some((invoice) => invoice.lineItems.length > 1)).toBe(true);
  });

  it("waits out a THROTTLED answer for exactly the points the query needs, then succeeds", async () => {
    const { target, jobber, lines } = await connected();
    const bucket = target.twin.rateLimit(`jobber:client:${JOBBER_APP.clientId}`, () => new LeakyBucket(COST_LIMITS));
    bucket.check(target.twin.clock.nowMs());
    bucket.spend(COST_LIMITS.capacity); // the app's budget is empty

    const before = target.twin.clock.nowMs();
    const data = await jobber.query<{ clients: { nodes: unknown[] } }>("{ clients(first: 10) { nodes { id name } } }"); // 20 points
    expect(data.clients.nodes).toHaveLength(10);
    expect(target.twin.clock.nowMs() - before).toBe(1000); // ceil((20 - 0) / 500) seconds
    expect(lines).toContain("Jobber: THROTTLED (needs 20 points, 0 available), waiting 1s");
  });

  it("refuses a query that costs more than the whole budget, since waiting would never help", async () => {
    const { target, jobber } = await connected();
    const before = target.twin.clock.nowMs();
    const expensive = "{ clients { nodes { jobs { nodes { visits { nodes { id } } } } } } }"; // 100 x 100 x 100 points
    await expect(jobber.query(expensive)).rejects.toThrow(/more than Jobber's whole budget/);
    expect(target.twin.clock.nowMs()).toBe(before);
  });

  it("backs off after the DDoS guard's 429 and a bad gateway, and every query still succeeds", async () => {
    const { target, jobber, lines } = await connected();
    target.twin.faultRules = [
      { name: "ddos-guard", vendor: "jobber", pathIncludes: "/api/graphql", rate: 0.4, effect: { status: 429 } },
      { name: "bad-gateway", vendor: "jobber", pathIncludes: "/api/graphql", rate: 0.2, effect: { status: 502 } },
    ];
    for (let i = 0; i < 10; i++) await jobber.query("{ account { name } }");
    expect(lines.filter((line) => line.includes("HTTP 429, retrying")).length).toBeGreaterThan(0);
    expect(lines.filter((line) => line.includes("HTTP 502, retrying")).length).toBeGreaterThan(0);
  });

  it("refreshes the token once when Jobber answers 401, then retries", async () => {
    const { target, runtime, jobberTokens } = await connected();
    // A client whose clock runs two hours slow believes its token is fresh; the twin knows better.
    const slowClock = { ...runtime, now: () => target.twin.clock.nowMs() - 2 * HOUR };
    const oauth = { ...JOBBER_APP, tokenUrl: ENDPOINTS.jobber.tokenUrl };
    const tokens = new TokenManager(oauth, jobberTokens.current, slowClock);
    const jobber = createJobberClient({ apiUrl: ENDPOINTS.jobber.apiUrl, tokens, runtime: slowClock });

    target.twin.advance(HOUR + 1);
    const data = await jobber.query<{ account: { name: string } }>("{ account { name } }");
    expect(data.account.name).toBe(target.twin.world.company.name);
    expect(tokens.refreshes).toBe(1);
  });

  it("reports GraphQL errors with Jobber's own messages", async () => {
    const { jobber } = await connected();
    const failure = await jobber.query("{ account { color } }").catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(JobberError);
    expect((failure as JobberError).message).toMatch(/color/);
  });
});
