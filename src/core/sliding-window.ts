/**
 * A rate limit of the form "N requests per period", counted over a sliding window of twin time: a request is
 * allowed while fewer than N were allowed in the period before it. Stricter than a LeakyBucket, which refills
 * steadily: once a burst uses up the limit, nothing more gets through until the whole period has passed. That
 * is the reading to use when a vendor says "wait a minute", as QuickBooks does.
 */
export interface WindowLimits {
  requests: number;
  periodMs: number;
}

export class SlidingWindowLimit {
  private allowedAt: number[] = []; // twin times of the requests allowed within the last period, oldest first

  constructor(readonly limits: WindowLimits) {}

  /** Allow one request at this twin time, or refuse it. Refused requests don't count against the limit. */
  take(nowMs: number): boolean {
    this.allowedAt = this.allowedAt.filter((at) => nowMs - at < this.limits.periodMs);
    if (this.allowedAt.length >= this.limits.requests) return false;
    this.allowedAt.push(nowMs);
    return true;
  }
}
