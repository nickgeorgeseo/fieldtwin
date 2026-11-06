import type { Context, Hono } from "hono";
import { grantTokens, type OAuthError, type OAuthPolicy, type TokenSet } from "../../core/oauth.ts";
import { missingGrantParameter, readForm, readJsonObject, redirectUriProblem, repeatedQueryParameter } from "../../core/request-body.ts";
import type { Twin } from "../../core/twin.ts";
import type { QboState } from "./types.ts";

/**
 * The Intuit OAuth 2.0 server, as documented:
 * https://developer.intuit.com/app/developer/qbo/docs/develop/authentication-and-authorization/oauth-2.0
 *
 * Real endpoints live on other hosts (appcenter.intuit.com, oauth.platform.intuit.com,
 * developer.api.intuit.com); the twin serves the same paths on its own base URL.
 */
export const QBO_OAUTH_POLICY: OAuthPolicy = {
  accessTokenSeconds: 3600, // "Access tokens are valid for 60 minutes (3,600 seconds)."
  authorizationCodeSeconds: 600, // not documented; see FIDELITY.md
  refreshTokenSeconds: 8_640_000, // "Refresh tokens have a rolling expiry of 100 days."
  rollingRefreshExpiry: true,
  rotateRefreshTokens: false, // the documented refresh response returns the same refresh_token
};

const ACCOUNTING_SCOPE = "com.intuit.quickbooks.accounting";

export function quickbooksOAuthRoutes(app: Hono, twin: Twin): void {
  const oauth = () => twin.oauthServer("quickbooks", QBO_OAUTH_POLICY);
  const nowMs = () => twin.clock.nowMs();

  // Step 9-11: the user approves (the twin always does) and Intuit redirects with code, state, and realmId.
  app.get("/connect/oauth2", (c) => {
    const { client_id: clientId, redirect_uri: redirectUri, response_type, scope, state } = c.req.query();
    if (!clientId || !redirectUri) {
      return c.json({ error: "invalid_request", error_description: "client_id and redirect_uri are required" }, 400);
    }
    // A repeated parameter redirects with invalid_request, like the other errors here, unless it leaves the
    // client or the redirect URI in doubt: then there's no one to safely send the browser back to (RFC 6749 4.1.2.1).
    // Asked about by name, so a state or scope repeated earlier in the query can't hide a second redirect_uri.
    const inDoubt = repeatedQueryParameter(c, ["client_id", "redirect_uri"]);
    if (inDoubt) return c.json({ error: "invalid_request", error_description: inDoubt.problem }, 400);
    const repeated = repeatedQueryParameter(c);
    const redirectProblem = redirectUriProblem(redirectUri);
    if (redirectProblem) return c.json({ error: "invalid_request", error_description: redirectProblem }, 400);
    const back = new URL(redirectUri);
    if (state !== undefined) back.searchParams.set("state", state);
    // A missing response_type is invalid_request, not unsupported (RFC 6749 4.1.2.1).
    if (repeated || !response_type) back.searchParams.set("error", "invalid_request");
    else if (response_type !== "code") back.searchParams.set("error", "unsupported_response_type");
    else if (!scope?.split(" ").includes(ACCOUNTING_SCOPE)) back.searchParams.set("error", "invalid_scope");
    else {
      const code = oauth().authorize({ clientId, redirectUri }, nowMs());
      if (typeof code !== "string") return c.json({ error: code.error, error_description: code.description }, 400);
      back.searchParams.set("code", code);
      back.searchParams.set("realmId", twin.state<QboState>("quickbooks").realmId);
    }
    return c.redirect(back.toString(), 302);
  });

  // Steps 12 and 15: exchange a code, or a refresh token, for tokens. The app authenticates with HTTP Basic.
  app.post("/oauth2/v1/tokens/bearer", async (c) => {
    const client = basicCredentials(c.req.header("Authorization"));
    if (!client)
      return c.json({ error: "invalid_client", error_description: "Send the app's client_id and client_secret as HTTP Basic auth" }, 401);
    const read = await readForm(c);
    if ("problem" in read) return c.json({ error: "invalid_request", error_description: read.problem }, 400);
    const field = (name: string) => read.form[name] ?? "";
    const missing = missingGrantParameter(field);
    if (missing) return c.json({ error: "invalid_request", error_description: missing }, 400);

    // Intuit documents no PKCE, so a code_verifier is ignored as any field the twin doesn't model.
    const result = grantTokens(oauth(), { clientId: client.id, field, pkce: false }, nowMs());
    if (!result) {
      return c.json({ error: "unsupported_grant_type", error_description: "grant_type must be authorization_code or refresh_token" }, 400);
    }
    return tokenResponse(c, result, nowMs());
  });

  // Step 16: revoke a token, which disconnects the app from the company.
  app.post("/v2/oauth2/tokens/revoke", async (c) => {
    const client = basicCredentials(c.req.header("Authorization"));
    if (!client) return c.json({ error: "invalid_client" }, 401);
    // The docs send JSON; a form works too. Media types are case-insensitive (RFC 9110 8.3.1).
    const isJson = /application\/json/i.test(c.req.header("Content-Type") ?? "");
    const read = isJson ? await readJsonObject(c, '{"token": "..."}') : await readForm(c);
    if ("problem" in read) return c.json({ error: "invalid_request", error_description: read.problem }, 400);
    const token = "body" in read ? read.body.token : read.form.token;
    if (typeof token !== "string") {
      return c.json({ error: "invalid_request", error_description: 'Send the token to revoke, like {"token": "..."}' }, 400);
    }
    // Revoking a token already revoked answers 200 again, as RFC 7009 2.2 allows: only a token never issued, or
    // issued to another app, is a 400.
    const refused = oauth().revoke({ clientId: client.id, token });
    if (refused) return c.json({ error: refused.error, error_description: refused.description }, 400);
    return c.body(null, 200);
  });
}

function tokenResponse(c: Context, result: TokenSet | OAuthError, nowMs: number) {
  if ("error" in result) return c.json({ error: result.error, error_description: result.description }, 400);
  return c.json({
    token_type: "bearer",
    expires_in: Math.round((result.accessExpiresMs - nowMs) / 1000),
    refresh_token: result.refreshToken,
    x_refresh_token_expires_in: Math.round(((result.refreshExpiresMs ?? nowMs) - nowMs) / 1000),
    access_token: result.accessToken,
  });
}

/**
 * "Basic " + base64encode(client_id + ":" + client_secret), as the docs show. Any non-empty pair is accepted.
 * RFC 6749 2.3.1 has each part form-encoded first, as OAuth libraries do, so they're decoded here: Intuit's
 * letters-and-digits credentials read the same either way, and a client_id like "dev@example.com" still matches.
 */
function basicCredentials(header: string | undefined): { id: string; secret: string } | undefined {
  const encoded = /^Basic (\S+)$/i.exec(header ?? "")?.[1];
  if (!encoded) return undefined;
  const [id, ...secret] = Buffer.from(encoded, "base64").toString().split(":").map(formDecode);
  return id && secret.join(":") ? { id, secret: secret.join(":") } : undefined;
}

/** application/x-www-form-urlencoded decoding; a part that isn't valid encoding is taken as it was sent. */
function formDecode(part: string): string {
  try {
    return decodeURIComponent(part.replace(/\+/g, " "));
  } catch {
    return part;
  }
}
