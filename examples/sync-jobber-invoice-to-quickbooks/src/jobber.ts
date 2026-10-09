import type { TokenManager } from "./oauth.ts";
import { type RetryPolicy, withRetries } from "./retry.ts";
import { REQUEST_TIMEOUT_MS, type Runtime } from "./runtime.ts";

/**
 * A small Jobber GraphQL client: one endpoint, a version header, a bearer token, and Jobber's two rate limits.
 * https://developer.getjobber.com/docs/using_jobbers_api/api_queries_and_mutations/
 * https://developer.getjobber.com/docs/using_jobbers_api/api_rate_limits
 *
 *   - The DDoS guard answers HTTP 429 when an app sends more than 2,500 requests in 5 minutes. No wait is
 *     documented, so the client backs off with jitter (retry.ts), as it does for a bad gateway.
 *   - The query-cost limit answers HTTP 200 with a THROTTLED error when a query's requestedQueryCost is more
 *     than the points currentlyAvailable. Points come back at restoreRate per second, so the client waits
 *     exactly long enough for the query to fit. "A query with a cost above [maximumAvailable] will never
 *     resolve", so that one fails at once with a message saying to ask for fewer nodes.
 *   - A 401 means the token was rejected: refresh once and try again.
 */

export const JOBBER_API_VERSION = "2025-04-16";

const JOBBER_RETRY: RetryPolicy = { maxAttempts: 8, baseDelayMs: 1000, maxDelayMs: 30_000 };
const MAX_THROTTLED_WAITS = 5;

export interface JobberClient {
  query<T>(document: string, variables?: Record<string, unknown>): Promise<T>;
}

interface GraphQLResponse {
  data?: unknown;
  errors?: { message: string; extensions?: { code?: string } }[];
  extensions?: { cost?: QueryCost };
}

interface QueryCost {
  requestedQueryCost: number;
  throttleStatus: { maximumAvailable: number; currentlyAvailable: number; restoreRate: number };
}

export class JobberError extends Error {
  override name = "JobberError";
  constructor(
    message: string,
    readonly errors: GraphQLResponse["errors"] = [],
  ) {
    super(message);
  }
}

export function createJobberClient(options: { apiUrl: string; tokens: TokenManager; runtime: Runtime; version?: string }): JobberClient {
  const { apiUrl, tokens, runtime } = options;
  const version = options.version ?? JOBBER_API_VERSION;

  /** One request, retried through 429s and 5xx. Each attempt asks for a token, so it never sends an expired one. */
  async function send(body: string): Promise<{ response: Response; token: string }> {
    let token = "";
    const attempt = async () => {
      token = await tokens.accessToken();
      return runtime.fetch(apiUrl, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
          Accept: "application/json",
          "X-JOBBER-GRAPHQL-VERSION": version,
        },
        body,
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
    };
    const response = await withRetries(attempt, JOBBER_RETRY, runtime, "Jobber");
    return { response, token };
  }

  /** The GraphQL answer to one document, after at most one token refresh. */
  async function post(document: string, variables: Record<string, unknown>): Promise<GraphQLResponse> {
    const body = JSON.stringify({ query: document, variables });
    let { response, token } = await send(body);
    if (response.status === 401) {
      await response.body?.cancel();
      await tokens.afterUnauthorized(token);
      ({ response } = await send(body));
    }
    if (!response.ok) throw new JobberError(`Jobber answered HTTP ${response.status}: ${await response.text()}`);
    return (await response.json()) as GraphQLResponse;
  }

  return {
    async query<T>(document: string, variables: Record<string, unknown> = {}): Promise<T> {
      for (let waits = 0; ; waits++) {
        const response = await post(document, variables);
        const throttled = response.errors?.some((error) => error.extensions?.code === "THROTTLED");
        if (!throttled) {
          if (response.errors?.length) throw new JobberError(response.errors.map((error) => error.message).join("; "), response.errors);
          return response.data as T;
        }

        const cost = response.extensions?.cost;
        if (!cost) throw new JobberError("Jobber throttled the query without saying what it costs.", response.errors);
        const { requestedQueryCost: needed, throttleStatus } = cost;
        if (needed > throttleStatus.maximumAvailable) {
          throw new JobberError(
            `This query costs ${needed} points, more than Jobber's whole budget of ${throttleStatus.maximumAvailable}, so it would never run. ` +
              "Ask for fewer nodes per page (first:) at each level.",
            response.errors,
          );
        }
        if (waits >= MAX_THROTTLED_WAITS) throw new JobberError(`Still throttled after ${waits} waits.`, response.errors);

        const available = Math.floor(throttleStatus.currentlyAvailable);
        const waitMs = Math.max(1, Math.ceil((needed - available) / throttleStatus.restoreRate)) * 1000;
        runtime.log(`Jobber: THROTTLED (needs ${needed} points, ${available} available), waiting ${waitMs / 1000}s`);
        await runtime.sleep(waitMs);
      }
    },
  };
}
