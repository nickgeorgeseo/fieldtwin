import { type RetryPolicy, withRetries } from "./retry.ts";
import { REQUEST_TIMEOUT_MS, type Runtime } from "./runtime.ts";

/**
 * OAuth 2.0 tokens for one vendor connection, kept fresh.
 *
 * QuickBooks: https://developer.intuit.com/app/developer/qbo/docs/develop/authentication-and-authorization/oauth-2.0
 * Jobber:     https://developer.getjobber.com/docs/building_your_app/app_authorization/
 *             https://developer.getjobber.com/docs/building_your_app/refresh_token_rotation/
 *
 * Access tokens last 60 minutes at both vendors. A TokenManager:
 *   - refreshes a few minutes before expiry, so requests rarely meet an expired token;
 *   - refreshes once more when an API still answers 401 for the token it sent (a skewed clock, a revoked token);
 *   - refreshes in a single flight: callers who need a token at the same moment share one refresh request.
 *     Jobber rotates refresh tokens, so two parallel refreshes would race and the loser would present a
 *     refresh token the winner had just invalidated;
 *   - always keeps the refresh token from the latest response, and hands every new set to onTokens to persist.
 *     Jobber's old refresh token stops working the moment a new one is issued. QuickBooks' documented sample
 *     returns the same one, but storing whatever comes back costs nothing;
 *   - with loadTokens, works alongside other processes sharing the connection (a webhook server and a scheduled
 *     job): before refreshing, and once more if the refresh token turns out to be dead, it reads the saved set, and
 *     uses the one another process already rotated to instead of asking the person to reconnect.
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

export interface TokenManagerOptions {
  /** Persist new tokens here (a database row per connection). A refresh doesn't finish until this does. */
  onTokens?: (tokens: Tokens) => void | Promise<void>;
  /** Read the saved tokens back (the row onTokens writes), for when other processes share this connection. */
  loadTokens?: () => Tokens | undefined | Promise<Tokens | undefined>;
  refreshMarginMs?: number; // how early to refresh; 5 minutes by default
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

const TOKEN_RETRY: RetryPolicy = { maxAttempts: 4, baseDelayMs: 1000, maxDelayMs: 10_000 };
const DOCUMENTED_LIFETIME_SECONDS = 3600; // used only if a response ever leaves out expires_in

/** Step two of connecting: trade the code your redirect URI received for the first set of tokens. */
export function exchangeCode(oauth: VendorOAuth, code: string, redirectUri: string, runtime: Runtime): Promise<Tokens> {
  return requestTokens(oauth, { grant_type: "authorization_code", code, redirect_uri: redirectUri }, runtime);
}

export class TokenManager {
  refreshes = 0;
  private refreshing: Promise<Tokens> | undefined;

  constructor(
    private readonly oauth: VendorOAuth,
    private tokens: Tokens,
    private readonly runtime: Runtime,
    private readonly options: TokenManagerOptions = {},
  ) {}

  get current(): Tokens {
    return this.tokens;
  }

  /** An access token that won't expire in the next few minutes, refreshing first if needed. */
  async accessToken(): Promise<string> {
    if (this.fresh(this.tokens)) return this.tokens.accessToken;
    return (await this.refresh()).accessToken;
  }

  private fresh(tokens: Tokens): boolean {
    return this.runtime.now() < tokens.expiresAtMs - (this.options.refreshMarginMs ?? 5 * 60_000);
  }

  /** The API answered 401 for `rejected`. Refresh, unless another request already replaced that token. */
  async afterUnauthorized(rejected: string): Promise<string> {
    if (this.tokens.accessToken !== rejected) return this.tokens.accessToken;
    return (await this.refresh()).accessToken;
  }

  private refresh(): Promise<Tokens> {
    this.refreshing ??= this.refreshNow().finally(() => {
      this.refreshing = undefined;
    });
    return this.refreshing;
  }

  private async refreshNow(): Promise<Tokens> {
    // Another process may have refreshed already. If so, its saved set is the one Jobber still honors.
    const saved = await this.newerSavedTokens();
    if (saved && this.fresh(saved)) return saved;
    try {
      return await this.refreshWith(this.tokens.refreshToken);
    } catch (error) {
      // Dead refresh token: another process may have rotated it a moment ago. Try its saved set once, then give up.
      const rotated = error instanceof OAuthError && error.code === "invalid_grant" ? await this.newerSavedTokens() : undefined;
      if (!rotated) throw error;
      return this.fresh(rotated) ? rotated : this.refreshWith(rotated.refreshToken);
    }
  }

  /** The saved tokens, adopted, if another process has saved a different set since this one last looked. */
  private async newerSavedTokens(): Promise<Tokens | undefined> {
    const saved = await this.options.loadTokens?.();
    if (!saved || saved.refreshToken === this.tokens.refreshToken) return undefined;
    this.tokens = saved;
    return saved;
  }

  private async refreshWith(refreshToken: string): Promise<Tokens> {
    const tokens = await requestTokens(
      this.oauth,
      { grant_type: "refresh_token", refresh_token: refreshToken },
      this.runtime,
      refreshToken,
    );
    // Keep the new set in memory first: if saving fails, this process can still finish its work.
    this.tokens = tokens;
    this.refreshes++;
    await this.options.onTokens?.(tokens);
    return tokens;
  }
}

async function requestTokens(
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
  const response = await withRetries(send, TOKEN_RETRY, runtime, `OAuth ${form.grant_type}`);
  const json = (await response.json().catch(() => ({}))) as Partial<Record<string, string | number>>;

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
