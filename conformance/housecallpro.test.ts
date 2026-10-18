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
