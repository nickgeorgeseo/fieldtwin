/**
 * A leaky-bucket rate limit, measured in twin time: a budget of points that refills at a steady rate.
 * Jobber's query-cost limit is one (10,000 points, 500 per second). Any vendor limit of the form
 * "N per period" can use it too.
 */
export interface BucketLimits {
  capacity: number;
  restorePerSecond: number;
}

export class LeakyBucket {
  private available: number;
  private lastUpdatedMs: number | null = null;

  constructor(readonly limits: BucketLimits) {
    this.available = limits.capacity;
  }

  /** Points available at this twin time, after refilling for the time that passed since the last look. */
  check(nowMs: number): number {
    if (this.lastUpdatedMs !== null && nowMs > this.lastUpdatedMs) {
      const seconds = (nowMs - this.lastUpdatedMs) / 1000;
      this.available = Math.min(this.limits.capacity, this.available + seconds * this.limits.restorePerSecond);
    }
    this.lastUpdatedMs = nowMs;
    return this.available;
  }

  /** Take points out. Returns what is left. */
  spend(points: number): number {
    this.available = Math.max(0, this.available - points);
    return this.available;
  }
}
