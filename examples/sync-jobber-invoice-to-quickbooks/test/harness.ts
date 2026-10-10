import { endpointsAt } from "../src/endpoints.ts";
import { createJobberClient } from "../src/jobber.ts";
import { TokenManager } from "../src/oauth.ts";
import { createQuickBooksClient } from "../src/quickbooks.ts";
import type { Runtime } from "../src/runtime.ts";
import { syncPaidInvoices } from "../src/sync.ts";
import { connectWithoutBrowser } from "../src/twin.ts";

/**
 * Runs the integration against an in-process twin: requests go straight to the twin's Hono app, sleeping
 * advances twin time, and now() is the twin's clock. Test files create the twin and pass it in; like everything
 * in examples/ outside a .test.ts file, this one never imports src/.
 */
export interface InProcessTwin {
  app: { request(input: string, init?: RequestInit): Response | Promise<Response> };
  twin: { advance(milliseconds: number): void; clock: { nowMs(): number } };
}

export const TWIN_URL = "http://twin.test";
export const ENDPOINTS = endpointsAt(TWIN_URL);
export const QUICKBOOKS_APP = { clientId: "sync-example-qbo", clientSecret: "dev-secret", clientAuthentication: "basic" } as const;
export const JOBBER_APP = { clientId: "sync-example-jobber", clientSecret: "dev-secret", clientAuthentication: "body" } as const;

export function inProcessRuntime(target: InProcessTwin, lines: string[] = []): Runtime {
  return {
    fetch: async (url, init) => target.app.request(url, init),
    sleep: async (milliseconds) => target.twin.advance(milliseconds),
    now: () => target.twin.clock.nowMs(),
    random: seededRandom(1),
    log: (line) => void lines.push(line),
  };
}

/** Connects both vendors through the twin's OAuth endpoints and returns a token manager for each. */
export async function connectBoth(target: InProcessTwin) {
  const lines: string[] = [];
  const runtime = inProcessRuntime(target, lines);
  const quickbooksOAuth = { ...QUICKBOOKS_APP, tokenUrl: ENDPOINTS.quickbooks.tokenUrl };
  const jobberOAuth = { ...JOBBER_APP, tokenUrl: ENDPOINTS.jobber.tokenUrl };

  const quickbooks = await connectWithoutBrowser("quickbooks", ENDPOINTS, quickbooksOAuth, runtime);
  const jobber = await connectWithoutBrowser("jobber", ENDPOINTS, jobberOAuth, runtime);
  return {
    runtime,
    lines,
    realmId: quickbooks.realmId!,
    quickbooksTokens: new TokenManager(quickbooksOAuth, quickbooks.tokens, runtime),
    jobberTokens: new TokenManager(jobberOAuth, jobber.tokens, runtime),
  };
}

/** Everything connected and ready to sync, the way main.ts wires it, but in process. */
export async function syncHarness(target: InProcessTwin, options: { requestIds?: boolean } = {}) {
  const connection = await connectBoth(target);
  const { runtime, realmId, jobberTokens, quickbooksTokens } = connection;
  const jobber = createJobberClient({ apiUrl: ENDPOINTS.jobber.apiUrl, tokens: jobberTokens, runtime });
  const newRequestId = options.requestIds === false ? () => undefined : undefined; // false: the client sends none
  const quickbooks = createQuickBooksClient({
    apiBase: ENDPOINTS.quickbooks.apiBase,
    realmId,
    tokens: quickbooksTokens,
    runtime,
    newRequestId,
  });
  return { ...connection, jobber, quickbooks, sync: (since: string) => syncPaidInvoices({ jobber, quickbooks, log: runtime.log }, since) };
}

/** The beginning of time, for a first run that syncs everything. */
export const EVER = "1970-01-01T00:00:00Z";

/** mulberry32: a tiny seeded generator, so retry jitter is the same on every run. */
function seededRandom(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
  };
}
