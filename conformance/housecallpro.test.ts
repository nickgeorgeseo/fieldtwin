import { describe, expect, it } from "vitest";
import { caseId, type Target } from "./case.ts";
import { CASES } from "./cases/index.ts";
import { nextRecording } from "./recordings.ts";
import { observeAll } from "./run.ts";

/**
 * What the Housecall Pro cases make of answers a real account might give, and what they refuse to record. Housecall
 * Pro has no sandbox, so a recording is made in a real account, reached with one of its API keys.
 */

const KEY = "0046421dc0ba47ec87bef0c089415380"; // the docs' sample key

/** A Housecall Pro account whose every answer comes from `answer`. It answers at once, so no case waits for it. */
function account(answer: (url: URL, init: RequestInit | undefined) => { status?: number; body: unknown }): Target {
  return {
    kind: "sandbox",
    fetch: async (url, init) => {
      const { status = 200, body } = answer(new URL(url), init);
      return Response.json(body, { status });
    },
    quickbooks: { apiBase: "https://books.test/v3", realmId: "1", accessToken: "t" },
    jobber: { apiUrl: "https://jobber.test/api/graphql", accessToken: "t" },
    housecallpro: { apiBase: "https://api.housecallpro.com", apiKey: KEY },
    now: async () => "2026-10-17T00:00:00Z",
  };
}

const housecallproCase = (name: string) => CASES.find((testCase) => caseId(testCase) === `housecallpro/${name}`)!;

describe("recording a Housecall Pro account", () => {
  it("keeps the API key out of what it records and what it says, even from an account that sends the key back", async () => {
    const echoing = account((_, init) => {
      const key = new Headers(init?.headers).get("Authorization");
      return { body: { id: key, message: key, error: { message: key }, work_status: key, customers: [{ id: key }] } };
    });
    const cases = CASES.filter((testCase) => testCase.vendor === "housecallpro");
    const results = await observeAll(echoing, cases);
    const { recording } = nextRecording(undefined, cases, results, "2026-10-17T00:00:00Z", "test");
    expect(Object.keys(recording.cases).length).toBeGreaterThan(0);
    expect(JSON.stringify(recording)).not.toContain(KEY);
    expect(JSON.stringify(results)).not.toContain(KEY);
  });

  it("takes a 401 for a location the key can't reach as the answer, but not once the key alone is refused too", async () => {
    const unknownLocation = housecallproCase("unknown-location");
    const refusingOtherLocations = account((url, init) => {
      const header = new Headers(init?.headers).get("X-Company-Id");
      const elsewhere = (header !== null && header !== "c") || url.searchParams.has("location_ids[]");
      return elsewhere ? { status: 401, body: { message: "Unauthorized" } } : { body: { id: "c", customers: [] } };
    });
    await expect(unknownLocation.observe(refusingOtherLocations)).resolves.toMatchObject({
      ownCompany: { status: 200 },
      unknownCompany: { status: 401 },
    });

    let requests = 0; // the key works for the first request, and stops working after it
    const keyDeletedPartWay = account(() =>
      requests++ === 0 ? { body: { id: "c" } } : { status: 401, body: { message: "Unauthorized" } },
    );
    await expect(unknownLocation.observe(keyDeletedPartWay)).rejects.toThrow("stopped accepting the API key");
  });
});

describe("cases that read records the account already has", () => {
  const empty = account(() => ({ body: { customers: [], jobs: [], invoices: [], estimates: [] } }));

  it.each([
    "customer-not-found",
    "job-not-found",
    "invoice-not-found",
    "estimate-not-found",
    "job-for-unknown-customer",
    "invoice-number-sort",
    "multi-visit-schedule",
    "amount-due-in-cents",
    "invoice-number-is-job-number",
    "invoice-items-are-job-lines",
  ])("%s records nothing from an account without those records, which could never match the twin's", async (name) => {
    await expect(housecallproCase(name).observe(empty)).rejects.toThrow("can't tell");
  });

  it("tells job numbers sorted as text from numbers sorted as numbers, and can't tell from numbers as long as each other", async () => {
    const sort = housecallproCase("invoice-number-sort");
    const numbered = (...numbers: string[]) => account(() => ({ body: { jobs: numbers.map((invoice_number) => ({ invoice_number })) } }));
    await expect(sort.observe(numbered("1", "10", "2"))).resolves.toEqual({ sortedAs: "text" });
    await expect(sort.observe(numbered("1", "2", "10"))).resolves.toEqual({ sortedAs: "numbers" });
    await expect(sort.observe(numbered("101", "102"))).rejects.toThrow("can't tell");
  });

  it("tells amount_due read as dollars from amount_due read as cents", async () => {
    const invoice = { id: "invoice_1", due_amount: 64100 };
    const readingDollars = account((url) => {
      const [min, max] = ["amount_due_min", "amount_due_max"].map((name) => url.searchParams.get(name));
      const found = min === null || (Number(min) * 100 <= invoice.due_amount && Number(max) * 100 >= invoice.due_amount);
      return { body: { invoices: found ? [invoice] : [] } };
    });
    await expect(housecallproCase("amount-due-in-cents").observe(readingDollars)).resolves.toEqual({ readAs: "dollars" });
  });

  it("tells a schedule that ends with the first of two visits from one that runs to the last", async () => {
    const visit = (day: string) => ({ start_time: `2026-07-0${day}T15:00:00Z`, end_time: `2026-07-0${day}T17:00:00Z` });
    const schedule = {
      scheduled_start: "2026-07-01T15:00:00Z",
      scheduled_end: "2026-07-01T17:00:00Z",
      appointments: [visit("1"), visit("2")],
    };
    const endingEarly = account(() => ({ body: { jobs: [{ schedule }] } }));
    await expect(housecallproCase("multi-visit-schedule").observe(endingEarly)).resolves.toEqual({
      scheduleRunsFromFirstVisitToLast: false,
    });
  });
});
