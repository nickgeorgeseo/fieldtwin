import { describe, expect, it } from "vitest";
import { caseId, type Target } from "./case.ts";
import { CASES } from "./cases/index.ts";
import { checkTokens } from "./preflight.ts";

/**
 * Recordings are evidence, so they may not be quietly wrong: one made with a dead token or the wrong URL would make
 * every case fail as if the twin were wrong.
 */

/** A sandbox that answers every request with `status`, the way one does to an expired token. */
function sandboxAnswering(status: number, body: unknown = {}): Target {
  return {
    kind: "sandbox",
    fetch: async () => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } }),
    quickbooks: { apiBase: "https://sandbox-quickbooks.api.intuit.com/v3", realmId: "123", accessToken: "expired" },
    jobber: { apiUrl: "https://api.getjobber.com/api/graphql", accessToken: "expired" },
    now: async () => "2026-10-12T00:00:00Z",
  };
}

describe("recording against a sandbox", () => {
  it("stops before recording anything when a token is refused, and says what to do", async () => {
    await expect(checkTokens(sandboxAnswering(401), ["quickbooks"])).rejects.toThrow(
      "QuickBooks refused QBO_ACCESS_TOKEN (HTTP 401). Access tokens last an hour: get a fresh one",
    );
    await expect(checkTokens(sandboxAnswering(401, { message: "Invalid Token Error" }), ["jobber"])).rejects.toThrow(
      "Jobber refused JOBBER_ACCESS_TOKEN (HTTP 401)",
    );
  });

  it("stops when the QuickBooks base URL is wrong, rather than recording 404s", async () => {
    await expect(checkTokens(sandboxAnswering(404), ["quickbooks"])).rejects.toThrow("QBO_API_BASE");
  });

  it("goes ahead when every token works", async () => {
    const working: Target = {
      ...sandboxAnswering(200),
      fetch: async (url) =>
        new Response(JSON.stringify(String(url).includes("graphql") ? { data: { account: { id: "a" } } } : { CompanyInfo: {} }), {
          status: 200,
        }),
    };
    await expect(checkTokens(working, ["quickbooks", "jobber"])).resolves.toBeUndefined();
  });

  it("doesn't record the padding of ids from a testing account with no clients, which would never match", async () => {
    const encodedIds = CASES.find((testCase) => caseId(testCase) === "jobber/encoded-id-format")!;
    await expect(encodedIds.observe(sandboxAnswering(200, { data: { clients: { nodes: [] } } }))).rejects.toThrow("no clients");
  });
});

describe("recording against a sandbox it can't reach", () => {
  it("names the URL, rather than saying only that a fetch failed", async () => {
    const unreachable: Target = {
      ...sandboxAnswering(200),
      fetch: async () => {
        throw new TypeError("fetch failed");
      },
    };
    await expect(checkTokens(unreachable, ["quickbooks"])).rejects.toThrow(
      "Couldn't reach QuickBooks at https://sandbox-quickbooks.api.intuit.com/v3 (fetch failed)",
    );
  });
});
