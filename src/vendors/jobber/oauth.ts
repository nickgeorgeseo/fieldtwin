import { createHmac } from "node:crypto";
import type { Hono } from "hono";
import type { AccessTokenClaims, OAuthError, OAuthPolicy, TokenSet } from "../../core/oauth.ts";
import type { Twin } from "../../core/twin.ts";

/**
 * Jobber's OAuth 2.0 server, as documented:
 * App authorization:      https://developer.getjobber.com/docs/building_your_app/app_authorization/
 * Refresh token rotation: https://developer.getjobber.com/docs/building_your_app/refresh_token_rotation/
 */
export const JOBBER_OAUTH_POLICY: OAuthPolicy = {
  accessTokenSeconds: 3600, // "Access tokens expire after 60 minutes."
  authorizationCodeSeconds: 600, // "Authorization codes expire after 10 minutes and can only be used once."
  refreshTokenSeconds: null, // "Refresh tokens are long-lived"
  rollingRefreshExpiry: false,
  // "Refresh Token Rotation is enabled by default"; for apps created after January 2, 2024
  // "the previous token is immediately invalidated".
  rotateRefreshTokens: true,
  formatAccessToken: jwt,
};

export function jobberOAuthRoutes(app: Hono, twin: Twin): void {
  const oauth = () => twin.oauthServer("jobber", JOBBER_OAUTH_POLICY);
  const nowMs = () => twin.clock.nowMs();

  // Steps 1-3: the admin approves (the twin always does) and Jobber redirects back with the code and state.
  app.get("/api/oauth/authorize", (c) => {
    const { client_id: clientId, redirect_uri: redirectUri, state, code_challenge, code_challenge_method } = c.req.query();
    if (!clientId || !redirectUri || c.req.query("response_type") !== "code") {
      return c.json({ error: "invalid_request", error_description: "response_type=code, client_id, and redirect_uri are required" }, 400);
    }
    const code = oauth().authorize(
      { clientId, redirectUri, codeChallenge: code_challenge, codeChallengeMethod: code_challenge_method },
      nowMs(),
    );
    if (typeof code !== "string") return c.json({ error: code.error, error_description: code.description }, 400);

    const back = new URL(redirectUri);
    back.searchParams.set("code", code);
    if (state !== undefined) back.searchParams.set("state", state);
    return c.redirect(back.toString(), 302);
  });

  // Steps 4-5 and "Refreshing access tokens": the app sends its credentials in the form body.
  app.post("/api/oauth/token", async (c) => {
    const form = await c.req.parseBody();
    const field = (name: string) => (typeof form[name] === "string" ? (form[name] as string) : "");
    if (!field("client_id") || !field("client_secret")) {
      return c.json({ error: "invalid_client", error_description: "client_id and client_secret are required" }, 401);
    }

    let result: TokenSet | OAuthError;
    if (field("grant_type") === "authorization_code") {
      const request = { clientId: field("client_id"), code: field("code"), redirectUri: field("redirect_uri") };
      result = oauth().exchange({ ...request, codeVerifier: field("code_verifier") || undefined }, nowMs());
    } else if (field("grant_type") === "refresh_token") {
      result = oauth().refresh({ clientId: field("client_id"), refreshToken: field("refresh_token") }, nowMs());
    } else {
      return c.json({ error: "unsupported_grant_type", error_description: "grant_type must be authorization_code or refresh_token" }, 400);
    }

    if ("error" in result) return c.json({ error: result.error, error_description: result.description }, 400);
    return c.json({
      access_token: result.accessToken,
      refresh_token: result.refreshToken,
      token_type: "Bearer",
      expires_in: Math.round((result.accessExpiresMs - nowMs()) / 1000),
    });
  });
}

/**
 * "The access token is a standard JWT token whose payload contains an exp field encoding the expiry time."
 * Signed with a fixed, obviously fake key: these tokens only mean something to the twin.
 */
const SIGNING_KEY = "fieldtwin-jobber-twin-signing-key-not-a-secret";

function jwt(claims: AccessTokenClaims): string {
  const encode = (value: object) => Buffer.from(JSON.stringify(value)).toString("base64url");
  const header = encode({ typ: "JWT", alg: "HS256" });
  const payload = encode({
    iat: Math.floor(claims.issuedMs / 1000),
    exp: Math.floor(claims.expiresMs / 1000),
    client_id: claims.clientId,
    jti: claims.tokenId,
  });
  const signature = createHmac("sha256", SIGNING_KEY).update(`${header}.${payload}`).digest("base64url");
  return `${header}.${payload}.${signature}`;
}
