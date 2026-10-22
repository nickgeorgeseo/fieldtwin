import type { Context, Hono } from "hono";
import type { OAuthError, OAuthPolicy, TokenSet } from "../../core/oauth.ts";
import { readForm, readJsonObject, redirectUriProblem } from "../../core/request-body.ts";
import type { Twin } from "../../core/twin.ts";
import { HCP } from "./routes/base.ts";

/**
 * Housecall Pro's OAuth 2.0 server, for integration partners:
 * https://docs.housecallpro.com/docs/housecall-public-api/b87d37ae48a0d-authentication
 * Real endpoints: https://pro.housecallpro.com/oauth/authorize and https://api.housecallpro.com/oauth/token.
 * The twin serves both under /housecallpro: /housecallpro/oauth/authorize and /housecallpro/oauth/token.
 */
export const HCP_OAUTH_POLICY: OAuthPolicy = {
  // "expires_in represents the token lifetime in seconds": 2592000 in the code exchange sample, 2629745 in the
  // refresh one. The twin takes the shorter, 30 days, so a client never counts on a token outliving the real one.
  accessTokenSeconds: 2_592_000,
  // Not documented. Ten minutes, as Jobber and the OAuth spec's advice ("a maximum authorization code lifetime of
  // 10 minutes") have it (FIDELITY.md).
  authorizationCodeSeconds: 600,
  refreshTokenSeconds: null, // the docs give refresh tokens no lifetime
  rollingRefreshExpiry: false,
  // The docs don't say whether a refresh returns a new refresh token. The twin rotates them, the stricter reading:
  // code that stores the refresh token it gets back works either way, and code that doesn't finds out here.
  rotateRefreshTokens: true,
};

/** The one invalid_grant answer the docs show, for a code or refresh token that doesn't work, whatever the reason. */
const INVALID_GRANT =
  "The provided authorization grant is invalid, expired, revoked, does not match the redirection URI used in the authorization request, or was issued to another client.";

export function housecallproOAuthRoutes(app: Hono, twin: Twin): void {
  const oauth = () => twin.oauthServer("housecallpro", HCP_OAUTH_POLICY);
  const nowMs = () => twin.clock.nowMs();

  // Steps 2-3: the Pro logs in and authorizes the app (the twin always does), and Housecall Pro redirects to the
  // callback with the code.
  app.get(`${HCP}/oauth/authorize`, (c) => {
    const { client_id: clientId, redirect_uri: redirectUri, state, code_challenge, code_challenge_method } = c.req.query();
    if (!clientId || !redirectUri || c.req.query("response_type") !== "code") {
      return c.json({ error: "invalid_request", error_description: "response_type=code, client_id, and redirect_uri are required." }, 400);
    }
    const redirectProblem = redirectUriProblem(redirectUri);
    if (redirectProblem) return c.json({ error: "invalid_request", error_description: redirectProblem }, 400);
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

  // Steps 4 and "Refreshing Expired Access Tokens": the app's credentials and the grant, in a JSON body.
  app.post(`${HCP}/oauth/token`, async (c) => {
    const read = await readTokenRequest(c);
    if ("problem" in read) return c.json({ error: "invalid_request", error_description: read.problem }, 400);
    const field = (name: string) => (typeof read.fields[name] === "string" ? (read.fields[name] as string) : "");
    if (!field("client_id") || !field("client_secret")) {
      return c.json({ error: "invalid_client", error_description: "client_id and client_secret are required in the request body." }, 401);
    }

    let result: TokenSet | OAuthError;
    if (field("grant_type") === "authorization_code") {
      const request = { clientId: field("client_id"), code: field("code"), redirectUri: field("redirect_uri") };
      result = oauth().exchange({ ...request, codeVerifier: field("code_verifier") || undefined }, nowMs());
    } else if (field("grant_type") === "refresh_token") {
      result = oauth().refresh({ clientId: field("client_id"), refreshToken: field("refresh_token") }, nowMs());
    } else {
      return c.json({ error: "unsupported_grant_type", error_description: "grant_type must be authorization_code or refresh_token." }, 400);
    }

    // exchange() and refresh() refuse nothing but the grant, so every refusal is the one invalid_grant the docs show.
    if ("error" in result) return c.json({ error: result.error, error_description: INVALID_GRANT }, 400);
    return c.json({
      access_token: result.accessToken,
      token_type: "Bearer",
      expires_in: Math.round((result.accessExpiresMs - nowMs()) / 1000),
      refresh_token: result.refreshToken,
      scope: "public", // the scope in the docs' samples; the twin doesn't enforce scopes
      created_at: Math.floor(nowMs() / 1000), // a number, as in the refresh sample (the code sample quotes it)
    });
  });
}

/**
 * The docs send the token request as JSON. A form, as the OAuth spec has it and OAuth libraries send it, works too:
 * Housecall Pro's answers look like Rails' Doorkeeper's (its invalid_grant description, word for word, and
 * `created_at`), and Doorkeeper reads both. FIDELITY.md marks this to check.
 */
async function readTokenRequest(c: Context): Promise<{ fields: Record<string, unknown> } | { problem: string }> {
  if (/application\/json/i.test(c.req.header("Content-Type") ?? "")) {
    const read = await readJsonObject(c, '{"client_id": "...", "client_secret": "...", "grant_type": "authorization_code", "code": "..."}');
    return "problem" in read ? read : { fields: read.body };
  }
  const read = await readForm(c);
  return "problem" in read ? { problem: `${read.problem} Housecall Pro's docs send JSON.` } : { fields: read.form };
}
