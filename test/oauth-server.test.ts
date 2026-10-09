import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { type OAuthPolicy, OAuthServer } from "../src/core/oauth.ts";
import { SeededRandom } from "../src/core/random.ts";

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

const policy: OAuthPolicy = {
  accessTokenSeconds: 3600,
  authorizationCodeSeconds: 600,
  refreshTokenSeconds: null,
  rollingRefreshExpiry: false,
  rotateRefreshTokens: true,
};

const server = (overrides: Partial<OAuthPolicy> = {}) => new OAuthServer({ ...policy, ...overrides }, new SeededRandom(1));
const app = { clientId: "app-1", redirectUri: "https://app.example.com/callback" };

/** Authorize, then exchange the code: the happy path most tests start from. */
function connect(oauth: OAuthServer, nowMs = 0) {
  const code = oauth.authorize(app, nowMs);
  if (typeof code !== "string") throw new Error(code.description);
  const tokens = oauth.exchange({ ...app, code }, nowMs);
  if ("error" in tokens) throw new Error(tokens.description);
  return tokens;
}

describe("the twin OAuth server", () => {
  it("issues tokens for an authorization code, and verifies the access token until it expires", () => {
    const oauth = server();
    const tokens = connect(oauth);
    expect(tokens.accessExpiresMs).toBe(HOUR);
    expect(oauth.verify(tokens.accessToken, HOUR - 1)).toMatchObject({ clientId: "app-1" });
    expect(oauth.verify(tokens.accessToken, HOUR)).toEqual({ problem: "expired" });
    expect(oauth.verify("made-up", 0)).toEqual({ problem: "unknown" });
  });

  it("accepts an authorization code once, before it expires, from the same app and redirect URI", () => {
    const oauth = server();
    const code = oauth.authorize(app, 0) as string;
    expect(oauth.exchange({ ...app, code, redirectUri: "https://elsewhere.example.com" }, 0)).toMatchObject({ error: "invalid_grant" });
    expect(oauth.exchange({ ...app, code, clientId: "other-app" }, 0)).toMatchObject({ error: "invalid_grant" });
    expect(oauth.exchange({ ...app, code }, 0)).toHaveProperty("accessToken");
    expect(oauth.exchange({ ...app, code }, 0)).toMatchObject({ error: "invalid_grant" }); // already used

    const late = oauth.authorize(app, 0) as string;
    expect(oauth.exchange({ ...app, code: late }, 10 * MINUTE)).toMatchObject({ error: "invalid_grant" }); // expired
  });

  it("checks a PKCE verifier against an S256 challenge", () => {
    const oauth = server();
    const verifier = "a-code-verifier-that-is-at-least-forty-three-characters-long";
    const challenge = createHash("sha256").update(verifier).digest("base64url");
    const code = oauth.authorize({ ...app, codeChallenge: challenge, codeChallengeMethod: "S256" }, 0) as string;
    expect(oauth.exchange({ ...app, code }, 0)).toMatchObject({ error: "invalid_grant" });

    const again = oauth.authorize({ ...app, codeChallenge: challenge, codeChallengeMethod: "S256" }, 0) as string;
    expect(oauth.exchange({ ...app, code: again, codeVerifier: "wrong" }, 0)).toMatchObject({ error: "invalid_grant" });

    const third = oauth.authorize({ ...app, codeChallenge: challenge, codeChallengeMethod: "S256" }, 0) as string;
    expect(oauth.exchange({ ...app, code: third, codeVerifier: verifier }, 0)).toHaveProperty("accessToken");

    expect(oauth.authorize({ ...app, codeChallenge: verifier, codeChallengeMethod: "plain" }, 0)).toMatchObject({
      error: "invalid_request",
    });
  });

  it("rotates refresh tokens when the policy says so: the old one stops working at once", () => {
    const oauth = server({ rotateRefreshTokens: true });
    const first = connect(oauth);
    const second = oauth.refresh({ clientId: "app-1", refreshToken: first.refreshToken }, 2 * HOUR);
    if ("error" in second) throw new Error(second.description);
    expect(second.refreshToken).not.toBe(first.refreshToken);
    expect(oauth.verify(second.accessToken, 2 * HOUR)).toMatchObject({ clientId: "app-1" });
    expect(oauth.refresh({ clientId: "app-1", refreshToken: first.refreshToken }, 2 * HOUR)).toMatchObject({ error: "invalid_grant" });
  });

  it("keeps the refresh token and rolls its expiry forward when the policy doesn't rotate", () => {
    const oauth = server({ rotateRefreshTokens: false, refreshTokenSeconds: 100 * 86_400, rollingRefreshExpiry: true });
    const first = connect(oauth);
    expect(first.refreshExpiresMs).toBe(100 * DAY);

    const later = oauth.refresh({ clientId: "app-1", refreshToken: first.refreshToken }, 50 * DAY);
    if ("error" in later) throw new Error(later.description);
    expect(later.refreshToken).toBe(first.refreshToken);
    expect(later.refreshExpiresMs).toBe(150 * DAY);

    expect(oauth.refresh({ clientId: "app-1", refreshToken: first.refreshToken }, 151 * DAY)).toMatchObject({ error: "invalid_grant" });
  });

  it("only refreshes for the app the token was issued to", () => {
    const oauth = server();
    const tokens = connect(oauth);
    expect(oauth.refresh({ clientId: "someone-else", refreshToken: tokens.refreshToken }, 0)).toMatchObject({ error: "invalid_grant" });
  });

  it("revokes the whole connection: every access and refresh token issued under it", () => {
    const oauth = server();
    const first = connect(oauth);
    const second = oauth.refresh({ clientId: "app-1", refreshToken: first.refreshToken }, 0);
    if ("error" in second) throw new Error(second.description);

    expect(oauth.revoke(first.accessToken)).toBe(true);
    expect(oauth.verify(second.accessToken, 0)).toEqual({ problem: "revoked" });
    expect(oauth.refresh({ clientId: "app-1", refreshToken: second.refreshToken }, 0)).toMatchObject({ error: "invalid_grant" });
    expect(oauth.revoke("not-a-token")).toBe(false);
  });

  it("issues the same tokens for the same requests, so runs are reproducible", () => {
    expect(connect(server())).toEqual(connect(server()));
  });

  it("lets the vendor shape its access tokens, for example as a JWT carrying the expiry", () => {
    const oauth = server({ formatAccessToken: ({ clientId, expiresMs }) => `token-for-${clientId}-until-${expiresMs}` });
    expect(connect(oauth).accessToken).toBe(`token-for-app-1-until-${HOUR}`);
  });
});
