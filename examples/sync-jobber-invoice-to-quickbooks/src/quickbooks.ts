import { randomUUID } from "node:crypto";
import type { TokenManager } from "./oauth.ts";
import { type RetryPolicy, withRetries } from "./retry.ts";
import { REQUEST_TIMEOUT_MS, type Runtime } from "./runtime.ts";

/**
 * A small QuickBooks Online Accounting API client: read, write, and query, with OAuth, retries, and real errors.
 * https://developer.intuit.com/app/developer/qbo/docs/learn/rest-api-features
 *
 *   - A 429 waits 60 seconds, as Intuit's limits page says to before retrying
 *     (https://developer.intuit.com/app/developer/qbo/docs/learn/limits-and-throttles). 5xx answers back off
 *     with jitter.
 *   - Every write carries a requestid, the same one on every retry of that write: "If our service receives
 *     another request with the same request ID ... it can recognize and send the same response for the original
 *     request. This prevents duplication." That makes it safe to retry a create whose answer was lost.
 *     https://developer.intuit.com/app/developer/qbo/docs/learn/learn-basic-field-definitions (Request ID)
 *   - A 401 refreshes the token once and tries again.
 *   - Anything else that isn't 2xx becomes a QuickBooksError carrying the Fault's code and Detail.
 */

const QUICKBOOKS_RETRY: RetryPolicy = { maxAttempts: 8, baseDelayMs: 1000, maxDelayMs: 30_000, throttleWaitMs: 60_000 };

export interface QuickBooksClient {
  read<T>(entity: string, id: string): Promise<T>;
  /** Create (no Id) or update (Id and SyncToken): QuickBooks uses one POST endpoint for both. */
  write<T>(entity: string, body: object): Promise<T>;
  /** SELECT * FROM entity [clauses]. An empty result is an empty list. */
  query<T>(entity: string, clauses?: string): Promise<T[]>;
}

/** A QuickBooks Fault: `code` is the documented error code (5010 Stale Object, 6240 Duplicate Name, ...). */
export class QuickBooksError extends Error {
  override name = "QuickBooksError";
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly detail: string,
    readonly element?: string,
  ) {
    super(`${message} (${code}): ${detail}`);
  }
}

/** A query value in quotes, with apostrophes escaped as the query docs show: 'Adam\'s Candy Shop'. */
export function quoted(value: string): string {
  return `'${value.replaceAll("'", "\\'")}'`;
}

export function createQuickBooksClient(options: {
  apiBase: string;
  realmId: string;
  tokens: TokenManager;
  runtime: Runtime;
  newRequestId?: () => string | undefined; // undefined sends none: only to show what goes wrong without them
}): QuickBooksClient {
  const { apiBase, realmId, tokens, runtime } = options;
  const newRequestId = options.newRequestId ?? (() => randomUUID());

  async function send(method: string, path: string, body: string | undefined) {
    let token = "";
    const attempt = async () => {
      token = await tokens.accessToken();
      return runtime.fetch(`${apiBase}/v3/company/${realmId}/${path}`, {
        method,
        headers: { Authorization: `Bearer ${token}`, Accept: "application/json", ...(body && { "Content-Type": "application/json" }) },
        body,
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
    };
    const response = await withRetries(attempt, QUICKBOOKS_RETRY, runtime, `QuickBooks ${method} /${path.split("?")[0]}`);
    return { response, token };
  }

  async function request(method: "GET" | "POST", path: string, payload?: object): Promise<Record<string, unknown>> {
    const body = payload === undefined ? undefined : JSON.stringify(payload);
    let { response, token } = await send(method, path, body);
    if (response.status === 401) {
      await response.body?.cancel();
      await tokens.afterUnauthorized(token);
      ({ response } = await send(method, path, body));
    }
    if (!response.ok) throw await quickBooksError(response);
    return (await response.json()) as Record<string, unknown>;
  }

  return {
    async read<T>(entity: string, id: string) {
      return (await request("GET", `${entity.toLowerCase()}/${encodeURIComponent(id)}`))[entity] as T;
    },
    async write<T>(entity: string, body: object) {
      const requestId = newRequestId(); // once per write, so every retry of it carries the same one
      const path = requestId === undefined ? entity.toLowerCase() : `${entity.toLowerCase()}?requestid=${encodeURIComponent(requestId)}`;
      return (await request("POST", path, body))[entity] as T;
    },
    async query<T>(entity: string, clauses = "") {
      const statement = `SELECT * FROM ${entity}${clauses ? ` ${clauses}` : ""}`;
      const result = await request("GET", `query?query=${encodeURIComponent(statement)}`);
      // QuickBooks leaves the entity key out of QueryResponse when nothing matches.
      return ((result.QueryResponse as Record<string, unknown> | undefined)?.[entity] ?? []) as T[];
    },
  };
}

/**
 * Error bodies are { Fault: { Error: [{ Message, Detail, code, element }], type } }:
 * https://developer.intuit.com/app/developer/qbo/docs/develop/troubleshooting/error-codes
 * 401 bodies reportedly arrive in lower case ({ fault: { error: [{ message, detail, code }] } }), so read both.
 */
async function quickBooksError(response: Response): Promise<QuickBooksError> {
  type Fault = { Error?: FaultError[]; error?: FaultError[] };
  type FaultError = Partial<Record<"Message" | "message" | "Detail" | "detail" | "code" | "element", string>>;
  const body = (await response.json().catch(() => ({}))) as { Fault?: Fault; fault?: Fault };
  const fault = body.Fault ?? body.fault;
  const error = (fault?.Error ?? fault?.error)?.[0] ?? {};
  return new QuickBooksError(
    response.status,
    String(error.code ?? response.status),
    error.Message ?? error.message ?? `HTTP ${response.status}`,
    error.Detail ?? error.detail ?? "",
    error.element,
  );
}
