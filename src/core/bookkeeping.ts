import { type OAuthPolicy, OAuthServer } from "./oauth.ts";
import type { SeededRandom } from "./random.ts";
import type { VendorName } from "./types.ts";

/**
 * Request bookkeeping: what the twin remembers about apps and their requests, deliberately outside the event log
 * (ARCHITECTURE.md, rule 1). Nothing about the fake business changes when a rate-limit budget is spent or a token
 * is issued, so none of it is replayed.
 *
 *   - Rate-limit budgets belong to a history: reset() and rewind() clear them, because the spending they remember
 *     belongs to a history that no longer exists.
 *   - OAuth connections belong to your app rather than to the business data, so they survive reset() and rewind(),
 *     the way a real app stays connected while its data changes.
 */
export class Bookkeeping {
  private rateLimits = new Map<string, unknown>();
  private oauthServers = new Map<VendorName, OAuthServer>();

  /** `oauthRandom` gives each vendor's OAuth server its own seeded stream, so issuing tokens never changes the world. */
  constructor(private readonly oauthRandom: (vendor: VendorName) => SeededRandom) {}

  /** A vendor's OAuth server, created on first use with the vendor's documented policy. */
  oauthServer(vendor: VendorName, policy: OAuthPolicy): OAuthServer {
    let server = this.oauthServers.get(vendor);
    if (!server) {
      server = new OAuthServer(policy, this.oauthRandom(vendor));
      this.oauthServers.set(vendor, server);
    }
    return server;
  }

  /**
   * The rate limit kept under a key (one vendor app, one company), made by `create` on first use: a LeakyBucket,
   * a SlidingWindowLimit, or whatever the vendor's documented limit needs. Prefix keys with the vendor's name.
   */
  rateLimit<Limit>(key: string, create: () => Limit): Limit {
    if (!this.rateLimits.has(key)) this.rateLimits.set(key, create());
    return this.rateLimits.get(key) as Limit;
  }

  clearRateLimits(): void {
    this.rateLimits.clear();
  }
}
