import type { Runtime } from "./runtime.ts";
import { OAuthError, requestTokens, type Tokens, type VendorOAuth } from "./token-endpoint.ts";

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
 *     job): before refreshing, and again if the refresh token turns out to be dead (a few times, a second apart, in
 *     case the other process is still saving), it reads the saved set, and uses the one another process already
 *     rotated to instead of asking the person to reconnect.
 *
 * What the token endpoint itself is asked, and what its answers mean, is in token-endpoint.ts.
 */

export interface TokenManagerOptions {
  /** Persist new tokens here (a database row per connection). A refresh doesn't finish until this does. */
  onTokens?: (tokens: Tokens) => void | Promise<void>;
  /** Read the saved tokens back (the row onTokens writes), for when other processes share this connection. */
  loadTokens?: () => Tokens | undefined | Promise<Tokens | undefined>;
  refreshMarginMs?: number; // how early to refresh; 5 minutes by default
}

const SAVED_TOKEN_READS = 3; // after an invalid_grant, how often to look for another process's save, a second apart

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
      // Dead refresh token: another process may have rotated it a moment ago, and be saving the new set right now.
      if (!(error instanceof OAuthError && error.code === "invalid_grant" && this.options.loadTokens)) throw error;
      const rotated = await this.rotatedElsewhere();
      if (!rotated) throw error;
      return this.fresh(rotated) ? rotated : this.refreshWith(rotated.refreshToken);
    }
  }

  /** The set another process rotated to, looked for a few times, a second apart, so a save on its way can land. */
  private async rotatedElsewhere(): Promise<Tokens | undefined> {
    for (let read = 1; ; read++) {
      const rotated = await this.newerSavedTokens();
      if (rotated || read >= SAVED_TOKEN_READS) return rotated;
      await this.runtime.sleep(1000);
    }
  }

  /**
   * The saved tokens, adopted, if another process has saved a newer set: one that expires later than this one's. An
   * older saved set is never taken over the one in hand: if a save failed, the saved refresh token is already dead.
   */
  private async newerSavedTokens(): Promise<Tokens | undefined> {
    const saved = await this.options.loadTokens?.();
    if (!saved || saved.expiresAtMs <= this.tokens.expiresAtMs) return undefined;
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
