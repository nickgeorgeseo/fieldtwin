import { randomUUID } from "node:crypto";

/**
 * A conformance case is a short scripted session against one vendor API, boiled down to observations a twin and
 * the real service should agree on: statuses, error codes, the shape of an answer, whether a SyncToken moved.
 * Never things that differ by design, like Ids, times, tokens, or the wording of messages.
 *
 * Cases reach their target over HTTP only, so the same case runs against a vendor sandbox and against a twin.
 */
export type Observation = string | number | boolean | null | Observation[] | { [key: string]: Observation };
export type Observations = Record<string, Observation>;

export interface Target {
  kind: "twin" | "sandbox";
  fetch: (url: string, init?: RequestInit) => Promise<Response>;
  quickbooks: { apiBase: string; realmId: string; accessToken: string }; // apiBase ends in /v3
  jobber: { apiUrl: string; accessToken: string };
  now(): Promise<string>; // the target's current time, ISO 8601
}

export interface ConformanceCase {
  name: string; // stable: recordings are keyed by it
  vendor: "quickbooks" | "jobber";
  endpoint: string; // what it exercises, e.g. "POST /payment"
  fidelity: string; // the FIDELITY.md row it checks
  writes?: boolean; // creates records in the target; the recorder lists these before it runs
  observe(target: Target): Promise<Observations>;
}

/** A case's key in results: its vendor and name ("quickbooks/read-missing-entity"). Recordings key by name, per vendor. */
export function caseId(testCase: Pick<ConformanceCase, "vendor" | "name">): string {
  return `${testCase.vendor}/${testCase.name}`;
}

export interface Answer {
  status: number;
  // biome-ignore lint/suspicious/noExplicitAny: an answer is whatever JSON the vendor sent; cases pick out what they observe
  body: any;
}

/** What a request may ask for besides the target's own settings. */
interface RequestOptions {
  token?: string; // instead of the target's, for the cases about bad tokens
  anyAnswer?: boolean; // return even an answer that is never evidence (preflight reports those itself)
}

/**
 * An answer no case may observe: the vendor was throttling or down, or stopped accepting the run's own token (they
 * last an hour). It says nothing about the API, so the case stops, and a recording keeps what it observed last time.
 */
function refuseUnrecordable(vendor: string, answer: Answer, ownToken: boolean): void {
  const throttled = answer.status === 429 || answer.body?.errors?.[0]?.extensions?.code === "THROTTLED";
  if (throttled || [502, 503, 504].includes(answer.status)) {
    const what = throttled ? "that it is throttling" : `HTTP ${answer.status}`;
    throw new Error(`${vendor} answered ${what}, which says nothing about the API: try again later`);
  }
  if (answer.status === 401 && ownToken) {
    throw new Error(`${vendor} stopped accepting the access token (HTTP 401). Tokens last an hour: get a fresh one`);
  }
}

/** A QuickBooks request. `realmId` and `token` override the target's, for the cases about wrong ones. */
export async function quickbooks(
  target: Target,
  method: "GET" | "POST",
  path: string,
  body?: unknown,
  options: RequestOptions & { realmId?: string } = {},
): Promise<Answer> {
  const { apiBase, realmId, accessToken } = target.quickbooks;
  const response = await target.fetch(`${apiBase}/company/${options.realmId ?? realmId}/${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${options.token ?? accessToken}`,
      Accept: "application/json",
      ...(body !== undefined && { "Content-Type": "application/json" }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const answer = { status: response.status, body: await response.json().catch(() => null) };
  if (!options.anyAnswer) refuseUnrecordable("QuickBooks", answer, options.token === undefined);
  return answer;
}

/** A QuickBooks query, by statement. */
export function quickbooksQuery(target: Target, statement: string): Promise<Answer> {
  return quickbooks(target, "GET", `query?query=${encodeURIComponent(statement)}`);
}

/** A Jobber GraphQL request. `version: null` sends no version header; `token` overrides the target's. */
export async function jobber(
  target: Target,
  query: string,
  options: RequestOptions & { variables?: Record<string, unknown>; version?: string | null } = {},
): Promise<Answer> {
  const version = options.version === undefined ? "2025-04-16" : options.version;
  const response = await target.fetch(target.jobber.apiUrl, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${options.token ?? target.jobber.accessToken}`,
      "Content-Type": "application/json",
      ...(version !== null && { "X-JOBBER-GRAPHQL-VERSION": version }),
    },
    body: JSON.stringify({ query, variables: options.variables ?? {} }),
  });
  const answer = { status: response.status, body: await response.json().catch(() => null) };
  if (!options.anyAnswer) refuseUnrecordable("Jobber", answer, options.token === undefined);
  return answer;
}

/**
 * What a QuickBooks error looks like, without its wording: the casing of the fault key, its type, and its code.
 * Documented errors are { Fault: { Error: [...], type } }; 401s are reported to arrive as { fault: { error: [...] } }.
 */
export function faultOf(answer: Answer): Observations {
  const body = answer.body ?? {};
  const key = "Fault" in body ? "Fault" : "fault" in body ? "fault" : null;
  const fault = key ? body[key] : {};
  const error = (fault.Error ?? fault.error ?? [])[0] ?? {};
  return { status: answer.status, faultKey: key, faultType: fault.type ?? null, code: error.code ?? null };
}

/** A name no earlier run has used, so cases can write to a sandbox that keeps its data between runs. */
export function unique(label: string): string {
  return `fieldtwin conformance ${label} ${randomUUID().slice(0, 8)}`;
}
