import { describe, expect, it } from "vitest";
import { TokenManager } from "../src/oauth.ts";
import { createQuickBooksClient } from "../src/quickbooks.ts";
import type { Runtime } from "../src/runtime.ts";
import { OAuthError } from "../src/token-endpoint.ts";
import { JOBBER_APP } from "./harness.ts";

/**
 * A token endpoint that is down, throttling, or out of reach: a failure to try again later, never a lost connection
 * that asks the person to reconnect, and never retried twice over.
 */
describe("a token endpoint that is down", () => {
  /** A TokenManager whose access token has expired, and a token endpoint that fails the way `fail` says. */
  function expiredTokens(fail: () => Promise<Response>) {
    let tokenRequests = 0;
    const runtime: Runtime = {
      fetch: async () => {
        tokenRequests++;
        return fail();
      },
      sleep: async () => {},
      now: () => 0,
      random: () => 0.5,
      log: () => {},
    };
    const oauth = { ...JOBBER_APP, tokenUrl: "https://auth.example.com/token" };
    const tokens = new TokenManager(oauth, { accessToken: "old", refreshToken: "still-good", expiresAtMs: 0 }, runtime);
    return { tokens, runtime, tokenRequests: () => tokenRequests };
  }

  it("is a failure to try again later, not a lost connection that needs the person to reconnect", async () => {
    const { tokens } = expiredTokens(async () => new Response("Service Unavailable", { status: 503 }));
    const failure = await tokens.accessToken().catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(Error);
    expect(failure).not.toBeInstanceOf(OAuthError);
    expect((failure as Error).message).toMatch(/HTTP 503.*try again later/i);
  });

  it("is asked at most four times for one API request, though the API client retries network failures too", async () => {
    const { tokens, runtime, tokenRequests } = expiredTokens(() => Promise.reject(new TypeError("fetch failed")));
    const quickbooks = createQuickBooksClient({ apiBase: "https://api.example.com", realmId: "1", tokens, runtime });
    await expect(quickbooks.read("Customer", "1")).rejects.not.toBeInstanceOf(OAuthError);
    expect(tokenRequests()).toBe(4);
  });
});
