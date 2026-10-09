/**
 * Everything the integration takes from the outside world: the network, the clock, randomness, and a log.
 *
 * Production passes the real ones (systemRuntime). Tests and the demo pass a twin's instead, so a 60-second
 * backoff costs 60 seconds of twin time rather than a real minute, and tokens expire on the twin's clock.
 */
export type Fetch = (url: string, init?: RequestInit) => Promise<Response>;

/** Every request gives up after this long, so a hung connection becomes a retryable timeout instead of a stuck sync. */
export const REQUEST_TIMEOUT_MS = 30_000;

export interface Runtime {
  fetch: Fetch;
  sleep: (milliseconds: number) => Promise<void>;
  now: () => number; // epoch milliseconds
  random: () => number; // 0 <= n < 1, for retry jitter
  log: (line: string) => void;
}

export function systemRuntime(): Runtime {
  return {
    fetch: (url, init) => fetch(url, init),
    sleep: (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)),
    now: () => Date.now(),
    random: () => Math.random(),
    log: (line) => console.log(line),
  };
}
