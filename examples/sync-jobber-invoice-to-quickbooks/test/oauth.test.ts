import { describe, expect, it } from "vitest";
import { createApp } from "../../../src/app.ts";
import { OAuthError, TokenManager } from "../src/oauth.ts";
import { connectBoth, ENDPOINTS, inProcessRuntime, JOBBER_APP } from "./harness.ts";

const MINUTE = 60_000;

async function connected() {
  const target = createApp({ seed: 42, auth: "oauth" });
  return { target, ...(await connectBoth(target)) };
}

/** A raw refresh request, the way any client would send one, to see what the twin thinks of a refresh token. */
const refreshJobberWith = (target: ReturnType<typeof createApp>, refreshToken: string) =>
  target.app.request(ENDPOINTS.jobber.tokenUrl, {
    method: "POST",
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: refreshToken,
      client_id: JOBBER_APP.clientId,
      client_secret: JOBBER_APP.clientSecret,
    }),
  });

describe("connecting and keeping tokens fresh", () => {
  it("connects to QuickBooks and Jobber through the twin's OAuth endpoints, without a browser", async () => {
    const { target, realmId, quickbooksTokens, jobberTokens } = await connected();
    expect(realmId).toBe("9341000000000001");
    for (const tokens of [quickbooksTokens, jobberTokens]) {
      expect(tokens.current.accessToken).toBeTruthy();
      expect(tokens.current.expiresAtMs).toBe(target.twin.clock.nowMs() + 60 * MINUTE);
    }
  });

  it("refreshes a few minutes before the access token expires, and not before", async () => {
    const { target, realmId, quickbooksTokens } = await connected();
    const first = await quickbooksTokens.accessToken();
    target.twin.advance(54 * MINUTE);
    expect(await quickbooksTokens.accessToken()).toBe(first);
    target.twin.advance(2 * MINUTE);
    const second = await quickbooksTokens.accessToken();
    expect(second).not.toBe(first);
    expect(quickbooksTokens.refreshes).toBe(1);

    target.twin.advance(10 * MINUTE); // the first token has expired; the new one still works
    const read = await target.app.request(
      `${ENDPOINTS.quickbooks.apiBase}/v3/company/${realmId}/query?query=SELECT%20COUNT(*)%20FROM%20Customer`,
      {
        headers: { Authorization: `Bearer ${second}`, Accept: "application/json" },
      },
    );
    expect(read.status).toBe(200);
  });

  it("keeps Jobber's rotated refresh token, because the old one stops working at once", async () => {
    const { target, jobberTokens } = await connected();
    const original = jobberTokens.current.refreshToken;
    target.twin.advance(60 * MINUTE);
    await jobberTokens.accessToken();
    expect(jobberTokens.current.refreshToken).not.toBe(original);
    expect((await refreshJobberWith(target, original)).status).toBe(400);

    target.twin.advance(60 * MINUTE); // and the kept one works
    await jobberTokens.accessToken();
    expect(jobberTokens.refreshes).toBe(2);
  });

  it("shares one refresh between callers who ask at the same moment (single flight)", async () => {
    const { target, jobberTokens } = await connected();
    target.twin.advance(60 * MINUTE);
    // Two refreshes in parallel would race: Jobber rotates, so the second would present a dead refresh token.
    const tokens = await Promise.all([jobberTokens.accessToken(), jobberTokens.accessToken(), jobberTokens.accessToken()]);
    expect(new Set(tokens).size).toBe(1);
    expect(jobberTokens.refreshes).toBe(1);
  });

  it("refreshes once after a 401 for the rejected token, and not again for a token already replaced", async () => {
    const { jobberTokens } = await connected();
    const rejected = jobberTokens.current.accessToken;
    const replacement = await jobberTokens.afterUnauthorized(rejected);
    expect(replacement).not.toBe(rejected);
    expect(await jobberTokens.afterUnauthorized(rejected)).toBe(replacement); // a second request that got a 401 with the old token
    expect(jobberTokens.refreshes).toBe(1);
  });

  it("hands every new token set to onTokens, so it can be saved before the old refresh token is needed again", async () => {
    const target = createApp({ seed: 42, auth: "oauth" });
    const { jobberTokens } = await connectBoth(target);
    const saved: string[] = [];
    const runtime = inProcessRuntime(target);
    const oauth = { ...JOBBER_APP, tokenUrl: ENDPOINTS.jobber.tokenUrl };
    const manager = new TokenManager(oauth, jobberTokens.current, runtime, { onTokens: (tokens) => void saved.push(tokens.refreshToken) });
    target.twin.advance(60 * MINUTE);
    await manager.accessToken();
    expect(saved).toEqual([manager.current.refreshToken]);
  });

  it("says to reconnect the app when the refresh token is no longer valid", async () => {
    const target = createApp({ seed: 42, auth: "oauth" });
    const oauth = { ...JOBBER_APP, tokenUrl: ENDPOINTS.jobber.tokenUrl };
    const stale = new TokenManager(oauth, { accessToken: "x", refreshToken: "revoked-long-ago", expiresAtMs: 0 }, inProcessRuntime(target));
    const failure = await stale.accessToken().catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(OAuthError);
    expect((failure as OAuthError).code).toBe("invalid_grant");
    expect((failure as OAuthError).message).toMatch(/Reconnect/);
  });
});
