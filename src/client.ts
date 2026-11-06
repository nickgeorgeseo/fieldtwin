import { connectThroughOAuth, type OAuthApp } from "./client-oauth.ts";
import type {
  AuthMode,
  Change,
  Checkpoint,
  EventOf,
  EventSource,
  FaultRule,
  Scenario,
  ScenarioInfo,
  Tokens,
  TwinLogEvent,
  TwinStatus,
  VendorInfo,
  VendorName,
  WebhookReport,
  WebhookSubscription,
} from "./client-types.ts";

/**
 * A client for a twin's control plane (/_twin), for tests and scripts: `startTwin()` returns one, and `connectTwin(url)`
 * makes one for a twin started some other way (`npx fieldtwin`, a CI step, a container). It is plain fetch, with no
 * Node.js imports, so it works anywhere fetch does. Each method is one control-plane request (README "The control
 * plane"); a refusal throws a TwinError in the twin's own words.
 */
export interface TwinClient {
  /** Where the twin answers, like http://localhost:4010: the base URL for QuickBooks and Jobber, and /housecallpro under it. */
  readonly url: string;
  /** GET /_twin: company, seed, scenario, twin time, auth mode, faults, checkpoints, and what's scheduled next. */
  status(): Promise<TwinStatus>;
  /** Back to the seeded start of the loaded scenario (or the default world). Subscriptions and OAuth connections stay. */
  reset(): Promise<TwinStatus>;
  /** Load a ready-made scenario by name ("flaky-apis"), a scenario's YAML, or a scenario object. */
  loadScenario(scenario: string | Scenario): Promise<TwinStatus>;
  /** The ready-made scenarios loadScenario() takes by name. */
  scenarios(): Promise<ScenarioInfo[]>;
  /** Move twin time forward. Scheduled scenario events happen on the way; their webhooks are answered before this resolves. */
  advance(by: { minutes?: number; hours?: number; days?: number }): Promise<{ twinTime: string; scenarioEvents: number }>;
  /** Make something happen as if done in the vendor's own app: runAction("jobber", "payInvoices", 2). */
  runAction(vendor: VendorName, action: string, params: unknown): Promise<{ events: string[] }>;
  /** The vendors the twin serves, with the actions runAction() takes and the webhook topics each sends. */
  vendors(): Promise<VendorInfo[]>;
  /** Name this moment, to list what changed since it or rewind to it. A name already taken moves to now. */
  checkpoint(name: string): Promise<Checkpoint>;
  /**
   * What changed since a checkpoint, oldest first. `source: "api"` keeps only what your code's requests did; `vendor`
   * and `type` narrow the list, and its type with it: `changes("before", { vendor: "quickbooks", type: "InvoiceCreated" })`
   * gives events whose `data.invoice` is a QuickBooks invoice.
   */
  changes<Vendor extends VendorName = VendorName, Type extends string = string>(
    checkpoint: string,
    filter?: { source?: EventSource; vendor?: Vendor; type?: Type; after?: string },
  ): Promise<(EventOf<Vendor, Type> & { summary: string })[]>;
  /** Undo everything after a checkpoint: records, twin time, and fault dice go back. */
  rewind(checkpoint: string): Promise<TwinStatus>;
  /**
   * The event log, all of it, since a checkpoint, or after a position an earlier read returned, with where it ends now.
   * Reading after a position from a history the twin no longer has (a reset, a rewind, a restart) throws a TwinError
   * with status 409: read from the start again.
   */
  log(options?: { since?: string; after?: string }): Promise<{ events: TwinLogEvent[]; position: string }>;
  /** Replace the active fault rules ([] turns faults off). */
  setFaults(rules: FaultRule[]): Promise<{ activeFaults: string[] }>;
  /** "oauth" checks bearer tokens as the real APIs do; "any-token" accepts any. */
  setAuth(mode: AuthMode): Promise<{ authMode: AuthMode }>;
  /** Replace the webhook subscriptions ([] removes them all). */
  setWebhooks(subscriptions: WebhookSubscription[]): Promise<WebhookReport>;
  /** The subscriptions, and each recent delivery with how your app answered. */
  webhooks(): Promise<WebhookReport>;
  /**
   * Connect an app through the vendor's twin OAuth server, as a person approving it would, and return its tokens: for
   * tests that need a real token in oauth mode (flaky-apis turns it on). The twin approves every request at once.
   */
  connect(vendor: VendorName, app?: OAuthApp): Promise<Tokens>;
}

/** A request the twin refused, with its HTTP status and its own explanation as the message. */
export class TwinError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "TwinError";
  }
}

export type Fetch = (url: string, init?: RequestInit) => Promise<Response> | Response;

export interface ConnectOptions {
  /** How requests are sent: fetch by default. Pass `(url, init) => app.request(url, init)` to drive createApp() in process. */
  fetch?: Fetch;
}

/** A client for the twin at `url`. Nothing is sent until a method is called. */
export function connectTwin(url: string, options: ConnectOptions = {}): TwinClient {
  const base = url.replace(/\/+$/, "");
  const send = options.fetch ?? ((to: string, init?: RequestInit) => fetch(to, init));

  async function request(method: string, path: string, body?: { json: unknown } | { text: string }): Promise<Response> {
    const init: RequestInit = { method };
    if (body) {
      init.headers = { "Content-Type": "json" in body ? "application/json" : "text/yaml" };
      init.body = "json" in body ? JSON.stringify(body.json) : body.text;
    }
    const response = await send(`${base}/_twin${path}`, init);
    if (!response.ok) throw new TwinError(refusal(await response.text(), method, path, response.status), response.status);
    return response;
  }
  const json = async <T>(method: string, path: string, body?: { json: unknown } | { text: string }): Promise<T> =>
    (await (await request(method, path, body)).json()) as T;

  return {
    url: base,
    status: () => json("GET", ""),
    reset: () => json("POST", "/reset"),
    loadScenario: (scenario) =>
      typeof scenario !== "string"
        ? json("POST", "/scenario", { text: JSON.stringify(scenario) }) // JSON is YAML, so the same route reads it
        : /^[a-z0-9-]+$/.test(scenario)
          ? json("POST", `/scenarios/${scenario}`)
          : json("POST", "/scenario", { text: scenario }),
    scenarios: () => json("GET", "/scenarios"),
    advance: ({ minutes = 0, hours = 0, days = 0 }) =>
      json("POST", "/clock/advance", { json: { minutes: minutes + hours * 60 + days * 1440 } }),
    runAction: (vendor, action, params) => json("POST", `/actions/${segment(vendor)}/${segment(action)}`, { json: params }),
    vendors: () => json("GET", "/vendors"),
    checkpoint: (name) => json("POST", `/checkpoints/${segment(name)}`),
    changes: async (checkpoint, filter = {}) => {
      const query = new URLSearchParams();
      if (filter.source) query.set("source", filter.source);
      if (filter.after) query.set("after", filter.after);
      const changes = await json<Change[]>("GET", `/checkpoints/${segment(checkpoint)}/changes${query.size ? `?${query}` : ""}`);
      return changes.filter(
        (change) => (!filter.vendor || change.vendor === filter.vendor) && (!filter.type || change.type === filter.type),
      ) as never;
    },
    rewind: (checkpoint) => json("POST", `/checkpoints/${segment(checkpoint)}/rewind`),
    log: async ({ since, after } = {}) => {
      const query = new URLSearchParams();
      if (since) query.set("since", since);
      if (after) query.set("after", after);
      const response = await request("GET", `/log.jsonl${query.size ? `?${query}` : ""}`);
      const text = await response.text();
      const events = text ? text.split("\n").map((line) => JSON.parse(line) as TwinLogEvent) : [];
      return { events, position: response.headers.get("X-Twin-Log-Position") ?? "" };
    },
    setFaults: (rules) => json("PUT", "/faults", { json: rules }),
    setAuth: (mode) => json("PUT", "/auth", { json: { mode } }),
    setWebhooks: (subscriptions) => json("PUT", "/webhooks", { json: subscriptions }),
    webhooks: () => json("GET", "/webhooks"),
    connect: (vendor, app) => connectThroughOAuth(base, send, vendor, app),
  };
}

/** A name in a path, so a checkpoint called "a/b" or "50%" is still one segment. */
function segment(name: string): string {
  return encodeURIComponent(name);
}

/** The twin's own reason ({ "error": "..." }), or the status when the answer isn't one. */
function refusal(text: string, method: string, path: string, status: number): string {
  try {
    const body: unknown = JSON.parse(text);
    if (typeof body === "object" && body !== null && "error" in body && typeof body.error === "string") return body.error;
  } catch {
    // not JSON: fall through
  }
  return `${method} /_twin${path} answered HTTP ${status}${text ? `: ${text.slice(0, 200)}` : ""}`;
}
