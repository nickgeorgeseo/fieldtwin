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

export const VENDORS = ["quickbooks", "jobber", "housecallpro"] as const;
export type Vendor = (typeof VENDORS)[number];

export interface Target {
  kind: "twin" | "sandbox";
  fetch: (url: string, init?: RequestInit) => Promise<Response>;
  quickbooks: { apiBase: string; realmId: string; accessToken: string }; // apiBase ends in /v3
  jobber: { apiUrl: string; accessToken: string };
  housecallpro: { apiBase: string; apiKey: string }; // paths follow apiBase, as they follow https://api.housecallpro.com
  now(): Promise<string>; // the target's current time, ISO 8601
  pause?(ms: number): Promise<void>; // lets real time pass, for a sandbox that takes a moment to show a write. A twin needs none
}

export interface ConformanceCase {
  name: string; // stable: recordings are keyed by it
  vendor: Vendor;
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
 * An answer no case may observe: the vendor was throttling or down, or stopped accepting the run's own credential (an
 * expired token, a deleted key). It says nothing about the API, so the case stops, and a recording keeps its last.
 */
function refuseUnrecordable(
  vendor: string,
  answer: Answer,
  ownCredential: boolean,
  stoppedAccepting = "the access token (HTTP 401). Tokens last an hour: get a fresh one",
): void {
  const throttled = answer.status === 429 || answer.body?.errors?.[0]?.extensions?.code === "THROTTLED";
  if (throttled || [502, 503, 504].includes(answer.status)) {
    const what = throttled ? "that it is throttling" : `HTTP ${answer.status}`;
    throw new Error(`${vendor} answered ${what}, which says nothing about the API: try again later`);
  }
  if (answer.status === 401 && ownCredential) throw new Error(`${vendor} stopped accepting ${stoppedAccepting}`);
}

// The answer, with the run's own credential replaced by `label` wherever the body repeats it: recordings are made from
// answers and may hold no token or key, so a sandbox that echoes a header back loses it here, before any case sees it.
async function answerOf(response: Response, credential: string, label: string): Promise<Answer> {
  const text = await response.text();
  return { status: response.status, body: parsed(credential ? text.replaceAll(credential, label) : text) };
}

/**
 * A QuickBooks request. `realmId` and `token` override the target's, for the cases about wrong ones; `text` is a body
 * sent as it is, for the case about one that isn't JSON.
 */
export async function quickbooks(
  target: Target,
  method: "GET" | "POST",
  path: string,
  body?: unknown,
  options: RequestOptions & { realmId?: string; text?: string } = {},
): Promise<Answer> {
  const { apiBase, realmId, accessToken } = target.quickbooks;
  const sent = options.text ?? (body === undefined ? undefined : JSON.stringify(body));
  const response = await target.fetch(`${apiBase}/company/${options.realmId ?? realmId}/${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${options.token ?? accessToken}`,
      Accept: "application/json",
      ...(sent !== undefined && { "Content-Type": "application/json" }),
    },
    body: sent,
  });
  const answer = await answerOf(response, accessToken, "(the access token)");
  if (!options.anyAnswer) refuseUnrecordable("QuickBooks", answer, options.token === undefined);
  return answer;
}

/** A QuickBooks query, by statement. */
export function quickbooksQuery(target: Target, statement: string): Promise<Answer> {
  return quickbooks(target, "GET", `query?query=${encodeURIComponent(statement)}`);
}

/**
 * A Jobber GraphQL request. `version: null` sends no version header; `token` overrides the target's; `text` is a body
 * sent as it is, in place of the query and its variables, for the cases about bodies that aren't a GraphQL request.
 */
export async function jobber(
  target: Target,
  query: string,
  options: RequestOptions & { variables?: Record<string, unknown>; version?: string | null; text?: string } = {},
): Promise<Answer> {
  const version = options.version === undefined ? "2025-04-16" : options.version;
  const response = await target.fetch(target.jobber.apiUrl, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${options.token ?? target.jobber.accessToken}`,
      "Content-Type": "application/json",
      ...(version !== null && { "X-JOBBER-GRAPHQL-VERSION": version }),
    },
    body: options.text ?? JSON.stringify({ query, variables: options.variables ?? {} }),
  });
  const answer = await answerOf(response, target.jobber.accessToken, "(the access token)");
  if (!options.anyAnswer) refuseUnrecordable("Jobber", answer, options.token === undefined);
  return answer;
}

/**
 * A Housecall Pro request, sending the target's API key as `Token <key>`, the form "the headers must follow".
 * `authorization` sends another header instead (null sends none), for the cases about bad credentials; `companyId` names
 * a location in X-Company-Id; `text` is a body sent as it is, for the case about one that isn't JSON.
 * https://docs.housecallpro.com/docs/housecall-public-api/b87d37ae48a0d-authentication
 */
export async function housecallpro(
  target: Target,
  method: "GET" | "POST" | "PUT",
  path: string,
  body?: unknown,
  options: Omit<RequestOptions, "token"> & { authorization?: string | null; companyId?: string; text?: string } = {},
): Promise<Answer> {
  const { apiBase, apiKey } = target.housecallpro;
  const authorization = options.authorization === undefined ? `Token ${apiKey}` : options.authorization;
  const sent = options.text ?? (body === undefined ? undefined : JSON.stringify(body));
  const response = await target.fetch(`${apiBase}${path}`, {
    method,
    headers: {
      Accept: "application/json",
      ...(authorization !== null && { Authorization: authorization }),
      ...(options.companyId !== undefined && { "X-Company-Id": options.companyId }),
      ...(sent !== undefined && { "Content-Type": "application/json" }),
    },
    body: sent,
  });
  const answer = await answerOf(response, apiKey, "(the API key)");
  // A 401 is about the key only when the key went alone: one naming a location may be refusing the location, so a
  // case that names one asks again with the key alone afterwards.
  const keyAlone = options.authorization === undefined && options.companyId === undefined && !/[?&]location_ids/.test(path);
  const stopped = "the API key (HTTP 401). Check that HOUSECALLPRO_API_KEY is still one of the account's keys";
  if (!options.anyAnswer) refuseUnrecordable("Housecall Pro", answer, keyAlone, stopped);
  return answer;
}

function parsed(text: string): Answer["body"] {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

/**
 * The body of a 2xx answer; anything else stops the case with what went wrong. The body it quotes has lost the run's
 * credential already (answerOf), and reaches only the console: a case that stops is never recorded (recordings.ts).
 */
export function expectOk(answer: Answer, doing: string): Answer["body"] {
  if (answer.status >= 200 && answer.status < 300) return answer.body;
  throw new Error(`Couldn't ${doing}: HTTP ${answer.status} ${JSON.stringify(answer.body).slice(0, 300)}`);
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
