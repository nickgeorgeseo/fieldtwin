import { describe, expect, it } from "vitest";
import { backoffDelayMs, parseRetryAfter, type RetryPolicy, withRetries } from "../src/retry.ts";

const POLICY: RetryPolicy = { maxAttempts: 5, baseDelayMs: 1000, maxDelayMs: 8000 };
const NOW = Date.parse("2026-07-13T11:00:00Z");

/** A runtime that records every wait instead of waiting, and always draws the same jitter. */
function fakeRuntime(random = 0.5) {
  const waits: number[] = [];
  const lines: string[] = [];
  return {
    waits,
    lines,
    sleep: async (ms: number) => void waits.push(ms),
    now: () => NOW,
    random: () => random,
    log: (line: string) => void lines.push(line),
  };
}

/** A send function that answers each attempt from a script: a status, a Response, or an error to throw. */
function scripted(...script: (number | Response | Error)[]) {
  let calls = 0;
  const send = async () => {
    const next = script[Math.min(calls++, script.length - 1)]!;
    if (next instanceof Error) throw next;
    return next instanceof Response ? next : new Response(null, { status: next });
  };
  return { send, calls: () => calls };
}

describe("withRetries", () => {
  it("retries 429, 500, 502, 503, and 504, and returns the first response that isn't one", async () => {
    const runtime = fakeRuntime();
    const { send, calls } = scripted(429, 500, 502, 503, 504, 200);
    const response = await withRetries(send, { ...POLICY, maxAttempts: 6 }, runtime, "test");
    expect(response.status).toBe(200);
    expect(calls()).toBe(6);
    expect(runtime.waits).toHaveLength(5);
  });

  it("does not retry a 400 or a 404: asking again won't change the answer", async () => {
    for (const status of [400, 404]) {
      const { send, calls } = scripted(status, 200);
      expect((await withRetries(send, POLICY, fakeRuntime(), "test")).status).toBe(status);
      expect(calls()).toBe(1);
    }
  });

  it("retries a network failure or a timeout, but not other errors", async () => {
    const network = scripted(new TypeError("fetch failed"), new DOMException("The operation timed out.", "TimeoutError"), 200);
    expect((await withRetries(network.send, POLICY, fakeRuntime(), "test")).status).toBe(200);
    expect(network.calls()).toBe(3);

    const bug = scripted(new Error("reconnect required"), 200);
    await expect(withRetries(bug.send, POLICY, fakeRuntime(), "test")).rejects.toThrow("reconnect required");
    expect(bug.calls()).toBe(1);
  });

  it("gives up after maxAttempts, returning the last response or throwing the last network error", async () => {
    const statuses = scripted(503);
    expect((await withRetries(statuses.send, POLICY, fakeRuntime(), "test")).status).toBe(503);
    expect(statuses.calls()).toBe(5);

    const network = scripted(new TypeError("fetch failed"));
    await expect(withRetries(network.send, POLICY, fakeRuntime(), "test")).rejects.toThrow("fetch failed");
    expect(network.calls()).toBe(5);
  });

  it("waits as long as a Retry-After header says", async () => {
    const runtime = fakeRuntime();
    const { send } = scripted(new Response(null, { status: 503, headers: { "Retry-After": "7" } }), 200);
    await withRetries(send, POLICY, runtime, "test");
    expect(runtime.waits).toEqual([7000]);
  });

  it("waits the vendor's throttle time after a 429 that has no Retry-After, and backs off for anything else", async () => {
    const runtime = fakeRuntime(0.5);
    const { send } = scripted(429, 503, 200);
    await withRetries(send, { ...POLICY, throttleWaitMs: 60_000 }, runtime, "test");
    expect(runtime.waits).toEqual([60_000, 1000]); // the 503 is the second attempt: half of 2 seconds
  });

  it("says what it is retrying and how long it will wait", async () => {
    const runtime = fakeRuntime(0.5);
    await withRetries(scripted(503, 200).send, POLICY, runtime, "QuickBooks POST /invoice");
    expect(runtime.lines).toEqual(["QuickBooks POST /invoice: HTTP 503, retrying in 0.5s (attempt 2 of 5)"]);
  });
});

describe("backoffDelayMs", () => {
  it("is a random wait up to an exponentially growing ceiling (full jitter)", () => {
    expect([1, 2, 3, 4].map((attempt) => backoffDelayMs(attempt, POLICY, () => 0.999))).toEqual([999, 1998, 3996, 7992]);
    expect(backoffDelayMs(3, POLICY, () => 0)).toBe(0);
  });

  it("never waits longer than maxDelayMs", () => {
    expect(backoffDelayMs(20, POLICY, () => 0.999)).toBe(7992);
  });
});

describe("parseRetryAfter", () => {
  it("reads delay-seconds and HTTP dates, and ignores anything else", () => {
    expect(parseRetryAfter("120", NOW)).toBe(120_000);
    expect(parseRetryAfter("Mon, 13 Jul 2026 11:00:30 GMT", NOW)).toBe(30_000);
    expect(parseRetryAfter("Mon, 13 Jul 2026 10:00:00 GMT", NOW)).toBe(0); // already past
    expect(parseRetryAfter(null, NOW)).toBeUndefined();
    expect(parseRetryAfter("soon", NOW)).toBeUndefined();
  });
});
