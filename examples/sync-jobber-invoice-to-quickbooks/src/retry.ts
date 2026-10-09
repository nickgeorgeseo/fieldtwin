import type { Runtime } from "./runtime.ts";

/**
 * Retrying transient failures politely.
 *
 * Retryable: 429 (throttled), 500, 502, 503, 504, and network failures. Anything else is the caller's to
 * handle, because asking again won't change the answer to a bad request.
 *
 * How long to wait, in order of preference:
 *   1. a Retry-After header, when the server sends one (delay-seconds or an HTTP date);
 *   2. after a 429, the vendor's documented wait if it has one (QuickBooks: 60 seconds), via throttleWaitMs;
 *   3. exponential backoff with full jitter: a random wait between 0 and min(maxDelayMs, baseDelayMs * 2^(n-1))
 *      before attempt n+1, so many clients that failed together don't all come back together.
 *
 * Retrying a write is only safe when the server can't apply it twice. QuickBooks writes carry a requestid for
 * that (see quickbooks.ts); GraphQL reads are safe as they are.
 */
export interface RetryPolicy {
  maxAttempts: number;
  baseDelayMs: number;
  maxDelayMs: number;
  throttleWaitMs?: number; // a fixed wait after a 429 without Retry-After
}

export const RETRYABLE_STATUSES: ReadonlySet<number> = new Set([429, 500, 502, 503, 504]);

type RetryRuntime = Pick<Runtime, "sleep" | "now" | "random" | "log">;

/**
 * Calls `send` until it answers with something other than a retryable status, or attempts run out.
 * Returns the last response (the caller decides what a 4xx or a final 5xx means) or throws the last network error.
 * `send` runs again for every attempt, so it can pick up a fresh access token each time.
 */
export async function withRetries(
  send: () => Promise<Response>,
  policy: RetryPolicy,
  runtime: RetryRuntime,
  what: string,
): Promise<Response> {
  for (let attempt = 1; ; attempt++) {
    const outcome = await send().then(
      (response) => ({ response }),
      (error: unknown) => ({ error }),
    );
    const retryable = "error" in outcome ? isNetworkError(outcome.error) : RETRYABLE_STATUSES.has(outcome.response.status);
    if (!retryable || attempt >= policy.maxAttempts) {
      if ("error" in outcome) throw outcome.error;
      return outcome.response;
    }

    let waitMs: number;
    let problem: string;
    if ("error" in outcome) {
      waitMs = backoffDelayMs(attempt, policy, runtime.random);
      problem = "network error";
    } else {
      const { response } = outcome;
      await response.body?.cancel(); // let the connection go back to the pool
      waitMs =
        parseRetryAfter(response.headers.get("Retry-After"), runtime.now()) ??
        (response.status === 429 ? policy.throttleWaitMs : undefined) ??
        backoffDelayMs(attempt, policy, runtime.random);
      problem = `HTTP ${response.status}`;
    }
    runtime.log(`${what}: ${problem}, retrying in ${waitMs / 1000}s (attempt ${attempt + 1} of ${policy.maxAttempts})`);
    await runtime.sleep(waitMs);
  }
}

/** Full jitter: a random wait up to an exponentially growing ceiling, capped at maxDelayMs. */
export function backoffDelayMs(attempt: number, policy: RetryPolicy, random: () => number): number {
  const ceiling = Math.min(policy.maxDelayMs, policy.baseDelayMs * 2 ** (attempt - 1));
  return Math.floor(random() * ceiling);
}

/** Retry-After as milliseconds to wait: "120" (seconds) or an HTTP date. Undefined when absent or unreadable. */
export function parseRetryAfter(value: string | null, nowMs: number): number | undefined {
  if (!value) return undefined;
  if (/^\d+$/.test(value.trim())) return Number(value.trim()) * 1000;
  const at = Date.parse(value);
  return Number.isNaN(at) ? undefined : Math.max(0, at - nowMs);
}

/**
 * fetch rejects with a TypeError when the request never got an answer (DNS, refused, reset), and with a
 * TimeoutError when an AbortSignal.timeout() runs out. Any other error is a bug or a decision, not the network.
 */
function isNetworkError(error: unknown): boolean {
  return error instanceof TypeError || (error instanceof Error && error.name === "TimeoutError");
}
