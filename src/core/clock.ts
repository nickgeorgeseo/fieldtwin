/**
 * Twin time.
 *
 * Nothing in this codebase calls Date.now(). Everything asks the clock instead.
 * That is what makes runs reproducible, and it lets a test jump forward an hour instantly.
 */
export class TwinClock {
  private currentMs: number;

  constructor(start: string) {
    this.currentMs = Date.parse(start);
    if (Number.isNaN(this.currentMs)) {
      throw new Error(`TwinClock: "${start}" is not a valid ISO 8601 time`);
    }
  }

  now(): Date {
    return new Date(this.currentMs);
  }

  nowMs(): number {
    return this.currentMs;
  }

  nowIso(): string {
    return this.now().toISOString();
  }

  advance(milliseconds: number): void {
    if (milliseconds < 0) {
      throw new Error("Twin time only moves forward. Rewind to a checkpoint to go back.");
    }
    this.currentMs += milliseconds;
  }
}
