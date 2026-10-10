import type { Context, Hono } from "hono";
import type { OAuthError, OAuthPolicy, TokenSet } from "../../core/oauth.ts";
import { readForm, readJsonObject, redirectUriProblem } from "../../core/request-body.ts";
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
    const redirectProblem = redirectUriProblem(redirectUri);
    if (redirectProblem) return c.json({ error: "invalid_request", error_description: redirectProblem }, 400);
    const back = new URL(redirectUri);
    if (state !== undefined) back.searchParams.set("state", state);
    if (response_type !== "code") back.searchParams.set("error", "unsupported_response_type");
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

    let result: TokenSet | OAuthError;
    if (field("grant_type") === "authorization_code") {
      result = oauth().exchange({ clientId: client.id, code: field("code"), redirectUri: field("redirect_uri") }, nowMs());
    } else if (field("grant_type") === "refresh_token") {
      result = oauth().refresh({ clientId: client.id, refreshToken: field("refresh_token") }, nowMs());
    } else {
      return c.json({ error: "unsupported_grant_type", error_description: "grant_type must be authorization_code or refresh_token" }, 400);
    }
    return tokenResponse(c, result, nowMs());
  });

  // Step 16: revoke a token, which disconnects the app from the company.
  app.post("/v2/oauth2/tokens/revoke", async (c) => {
    if (!basicCredentials(c.req.header("Authorization"))) return c.json({ error: "invalid_client" }, 401);
    const isJson = c.req.header("Content-Type")?.includes("json");
    const read = isJson ? await readJsonObject(c, '{"token": "..."}') : await readForm(c);
    if ("problem" in read) return c.json({ error: "invalid_request", error_description: read.problem }, 400);
    const token = "body" in read ? read.body.token : read.form.token;
    if (typeof token !== "string" || !oauth().revoke(token)) {
      return c.json({ error: "invalid_request", error_description: "That token was never issued, or was already revoked" }, 400);
    }
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

/** "Basic " + base64encode(client_id + ":" + client_secret), as the docs show. Any non-empty pair is accepted. */
function basicCredentials(header: string | undefined): { id: string; secret: string } | undefined {
  const encoded = /^Basic (\S+)$/i.exec(header ?? "")?.[1];
  if (!encoded) return undefined;
  const [id, ...secret] = Buffer.from(encoded, "base64").toString().split(":");
  return id && secret.join(":") ? { id, secret: secret.join(":") } : undefined;
}
