import { type ConformanceCase, caseId, type Target } from "./case.ts";
import { CASES } from "./cases/index.ts";

/** What the conformance tests share: a sandbox that answers however a test says, and a case looked up by its id. */

/**
 * A sandbox whose every request `fetch` answers, at the real vendors' URLs, with credentials no vendor issued (the
 * Housecall Pro key is the docs' sample). `overrides` replace any of that, for a test about one vendor's settings.
 */
export function fakeTarget(fetch: Target["fetch"], overrides: Partial<Omit<Target, "fetch">> = {}): Target {
  return {
    kind: "sandbox",
    fetch,
    quickbooks: { apiBase: "https://sandbox-quickbooks.api.intuit.com/v3", realmId: "123", accessToken: "fieldtwin-quickbooks-token" },
    jobber: { apiUrl: "https://api.getjobber.com/api/graphql", accessToken: "fieldtwin-jobber-token" },
    housecallpro: { apiBase: "https://api.housecallpro.com", apiKey: "0046421dc0ba47ec87bef0c089415380" },
    now: async () => "2026-10-12T00:00:00Z",
    ...overrides,
  };
}

/** The case with this id ("quickbooks/read-missing-entity"). A test naming a case that doesn't exist fails here, by name. */
export function caseNamed(id: string): ConformanceCase {
  const found = CASES.find((testCase) => caseId(testCase) === id);
  if (!found) throw new Error(`There is no conformance case named ${id}`);
  return found;
}

/** A sandbox that answers every request with `status` and `body`, the way one does to an expired token. */
export function sandboxAnswering(status: number, body: unknown = {}): Target {
  return fakeTarget(async () => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } }));
}
