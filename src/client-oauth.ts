import { TwinError } from "./client-error.ts";
import type { Tokens, VendorName } from "./client-types.ts";

/**
 * connect(): the authorization code flow against a twin's OAuth server, with no browser. In production a person
 * approves the app on the vendor's consent page and the vendor redirects to your callback with ?code=; the twin
 * approves at once, so the code is read from the redirect's Location header instead. Then the code is exchanged at the
 * vendor's token endpoint, the way each vendor documents (README "Authentication").
 */

/** The app connecting: any client id and secret work on the twin. The redirect URI is never visited. */
export interface OAuthApp {
  clientId?: string;
  clientSecret?: string;
  redirectUri?: string;
}

type Fetch = (url: string, init?: RequestInit) => Promise<Response> | Response;

const VENDOR_OAUTH: Record<VendorName, { authorize: string; token: string; scope?: string; credentials: "basic" | "form" }> = {
  quickbooks: {
    authorize: "/connect/oauth2",
    token: "/oauth2/v1/tokens/bearer",
    scope: "com.intuit.quickbooks.accounting",
    credentials: "basic",
  },
  jobber: { authorize: "/api/oauth/authorize", token: "/api/oauth/token", credentials: "form" },
  housecallpro: { authorize: "/housecallpro/oauth/authorize", token: "/housecallpro/oauth/token", credentials: "form" },
};

// A fault rule can make the twin's OAuth endpoints fail too. A failure it injected is retried from the start, since a
// lost answer may have used up the code; anything else is the twin refusing, and is thrown.
const ATTEMPTS = 5;

export async function connectThroughOAuth(base: string, send: Fetch, vendor: VendorName, app: OAuthApp = {}): Promise<Tokens> {
  const oauth = VENDOR_OAUTH[vendor];
  if (!oauth) throw new Error(`No vendor named "${vendor}". Vendors: ${Object.keys(VENDOR_OAUTH).join(", ")}`);
  const { clientId = "fieldtwin-test", clientSecret = "fieldtwin-test-secret", redirectUri = "http://localhost:3000/callback" } = app;
  let refused = new TwinError("", 0);
  for (let attempt = 1; attempt <= ATTEMPTS; attempt++) {
    const authorize = new URLSearchParams({ response_type: "code", client_id: clientId, redirect_uri: redirectUri, state: "fieldtwin" });
    if (oauth.scope) authorize.set("scope", oauth.scope);
    const approval = await send(`${base}${oauth.authorize}?${authorize}`, { redirect: "manual" });
    const location = approval.headers.get("Location");
    if (approval.status !== 302 || !location) {
      refused = refusal(vendor, approval.status, await approval.text());
      if (approval.headers.has("X-Twin-Fault")) continue;
      break;
    }
    const callback = new URL(location).searchParams;
    const code = callback.get("code");
    // A refusal after the client is known comes back on the redirect, as ?error= and ?error_description= (RFC 6749 4.1.2.1).
    const denied = callback.get("error_description") ?? callback.get("error") ?? "no code in its redirect";
    if (!code) throw new TwinError(`${vendor} refused to authorize the app: ${denied}`, 400);

    const form = new URLSearchParams({ grant_type: "authorization_code", code, redirect_uri: redirectUri });
    const headers: Record<string, string> = { "Content-Type": "application/x-www-form-urlencoded" };
    // QuickBooks takes the app's credentials as HTTP Basic, each form-encoded first (RFC 6749 2.3.1); the others in the form.
    if (oauth.credentials === "basic")
      headers.Authorization = `Basic ${btoa(`${encodeURIComponent(clientId)}:${encodeURIComponent(clientSecret)}`)}`;
    else for (const [name, value] of Object.entries({ client_id: clientId, client_secret: clientSecret })) form.set(name, value);
    const exchange = await send(`${base}${oauth.token}`, { method: "POST", headers, body: form.toString() });
    const answer = await exchange.text();
    if (!exchange.ok) {
      refused = refusal(vendor, exchange.status, answer);
      if (exchange.headers.has("X-Twin-Fault")) continue;
      break;
    }
    const tokens = JSON.parse(answer) as { access_token: string; refresh_token: string; expires_in: number };
    const realmId = callback.get("realmId") ?? undefined;
    return {
      accessToken: tokens.access_token,
      refreshToken: tokens.refresh_token,
      expiresIn: tokens.expires_in,
      ...(realmId && { realmId }),
    };
  }
  throw refused;
}

/**
 * The OAuth server's own reason: its error_description, else its error code, as every vendor's OAuth endpoints answer
 * (RFC 6749 5.2). The status and the raw text only when the answer isn't one, like a fault rule's 503.
 */
function refusal(vendor: VendorName, status: number, text: string): TwinError {
  let reason = `HTTP ${status}${text ? `: ${text.slice(0, 200)}` : ""}`;
  try {
    const body: unknown = JSON.parse(text);
    if (typeof body === "object" && body !== null) {
      const { error, error_description: description } = body as { error?: unknown; error_description?: unknown };
      if (typeof description === "string") reason = description;
      else if (typeof error === "string") reason = error;
    }
  } catch {
    // not JSON: keep the status and the text
  }
  return new TwinError(`Couldn't connect to ${vendor}: ${reason}`, status);
}
