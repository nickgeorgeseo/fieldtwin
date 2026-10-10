import { RETRYABLE_STATUSES, type RetryPolicy, withRetries } from "./retry.ts";
import { REQUEST_TIMEOUT_MS, type Runtime } from "./runtime.ts";

/**
 * A vendor's OAuth 2.0 token endpoint: trading the code from connecting for tokens, refreshing them, and what each
 * kind of answer means. The endpoint saying no is an OAuthError; not being able to ask it is a TokenEndpointError.
 *
 * QuickBooks: https://developer.intuit.com/app/developer/qbo/docs/develop/authentication-and-authorization/oauth-2.0
 * Jobber:     https://developer.getjobber.com/docs/building_your_app/app_authorization/
 */

export interface VendorOAuth {
  tokenUrl: string;
  clientId: string;
  clientSecret: string;
  clientAuthentication: "basic" | "body"; // QuickBooks: HTTP Basic. Jobber: client_id and client_secret in the form body.
}

export interface Tokens {
  accessToken: string;
  refreshToken: string;
  expiresAtMs: number;
}

/** The token endpoint said no. With code "invalid_grant" on a refresh, the app has to be reconnected by a person. */
export class OAuthError extends Error {
  override name = "OAuthError";
  constructor(
    message: string,
    readonly status: number,
    readonly code?: string,
  ) {
    super(message);
  }
}

/**
 * The token endpoint couldn't be reached, or was down or throttling, even after retries. Unlike an OAuthError, the
 * connection itself is fine: what needed a token fails for now and is tried again later.
 */
export class TokenEndpointError extends Error {
  override name = "TokenEndpointError";
}

const TOKEN_RETRY: RetryPolicy = { maxAttempts: 4, baseDelayMs: 1000, maxDelayMs: 10_000 };
const DOCUMENTED_LIFETIME_SECONDS = 3600; // used only if a response ever leaves out expires_in

/** Step two of connecting: trade the code your redirect URI received for the first set of tokens. */
export function exchangeCode(oauth: VendorOAuth, code: string, redirectUri: string, runtime: Runtime): Promise<Tokens> {
  return requestTokens(oauth, { grant_type: "authorization_code", code, redirect_uri: redirectUri }, runtime);
}

/** One request to the token endpoint, retried through 429s, 5xx, and network failures, and its tokens. */
export async function requestTokens(
  oauth: VendorOAuth,
  form: Record<string, string>,
  runtime: Runtime,
  previousRefreshToken?: string,
): Promise<Tokens> {
  const body = new URLSearchParams(form);
  const headers: Record<string, string> = { Accept: "application/json", "Content-Type": "application/x-www-form-urlencoded" };
  if (oauth.clientAuthentication === "basic") {
    headers.Authorization = `Basic ${Buffer.from(`${oauth.clientId}:${oauth.clientSecret}`).toString("base64")}`;
  } else {
    body.set("client_id", oauth.clientId);
    body.set("client_secret", oauth.clientSecret);
  }

  // Retrying is safe for a 429 or 5xx the server answered before doing anything. If a refresh succeeds but its
  // answer is lost, a rotated refresh token is gone either way, and the retry's invalid_grant says to reconnect.
  const send = () =>
    runtime.fetch(oauth.tokenUrl, { method: "POST", headers, body: body.toString(), signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
  let response: Response;
  try {
    response = await withRetries(send, TOKEN_RETRY, runtime, `OAuth ${form.grant_type}`);
  } catch (error) {
    // Already retried: wrapped, so an API client that retries network failures doesn't send it all round again.
    throw new TokenEndpointError(`Couldn't reach the token endpoint (${(error as Error).message}). Try again later.`, { cause: error });
  }
  const json = (await response.json().catch(() => ({}))) as Partial<Record<string, string | number>>;

  // Only the endpoint saying no (a 4xx such as invalid_grant) means the connection is gone. Down, throttled, or an
  // answer that isn't a token (a proxy's error page) is temporary.
  if (typeof json.access_token !== "string" && (response.ok || RETRYABLE_STATUSES.has(response.status))) {
    throw new TokenEndpointError(`The token endpoint answered HTTP ${response.status} without a token. Try again later.`);
  }
  if (!response.ok || typeof json.access_token !== "string") {
    const code = typeof json.error === "string" ? json.error : undefined;
    const description = json.error_description ? ` (${json.error_description})` : "";
    const reconnect =
      code === "invalid_grant" && form.grant_type === "refresh_token" ? " Reconnect the app: the refresh token is no longer valid." : "";
    throw new OAuthError(
      `Token request failed with HTTP ${response.status}: ${code ?? "no access token"}${description}.${reconnect}`,
      response.status,
      code,
    );
  }

  const refreshToken = typeof json.refresh_token === "string" ? json.refresh_token : previousRefreshToken;
  if (!refreshToken) throw new OAuthError("The token response had no refresh_token.", response.status);
  const lifetimeSeconds = typeof json.expires_in === "number" ? json.expires_in : DOCUMENTED_LIFETIME_SECONDS;
  return { accessToken: json.access_token, refreshToken, expiresAtMs: runtime.now() + lifetimeSeconds * 1000 };
}
