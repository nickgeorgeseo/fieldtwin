import { type BucketLimits, LeakyBucket } from "./leaky-bucket.ts";
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
  private rateLimits = new Map<string, LeakyBucket>();
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

  /** The rate-limit budget for a key (e.g. one vendor app), created full on first use. */
  rateLimitBucket(key: string, limits: BucketLimits): LeakyBucket {
    let bucket = this.rateLimits.get(key);
    if (!bucket) {
      bucket = new LeakyBucket(limits);
      this.rateLimits.set(key, bucket);
    }
    return bucket;
  }

  clearRateLimits(): void {
    this.rateLimits.clear();
  }
}
