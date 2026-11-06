import type { AuthMode, Checkpoint, EventSource, FaultRule, VendorName } from "./core/types.ts";
import type { Delivery, WebhookSubscription } from "./core/webhooks.ts";
import type { HcpEventData } from "./vendors/housecallpro/events.ts";
import type { JobberEventData } from "./vendors/jobber/events.ts";
import type { QboEventData } from "./vendors/quickbooks/events.ts";
import type { WorldCompany } from "./world/generate-world.ts";

/**
 * What the control plane answers, as plain types for code that drives a twin: `import type { Change } from "fieldtwin"`.
 * test/client.test.ts ("the client's types") checks the answers against what control/operations.ts really returns. The
 * log stores an event's type as a plain string, so the event types (TwinLogEvent, Change) are built from each vendor's
 * events.ts instead, and the same test checks that they narrow by vendor and type.
 */

export type { AuthMode, Checkpoint, Delivery, EventSource, FaultRule, VendorName, WebhookSubscription };

/** One event of `Payload`'s vendor union, as the log holds it: the payload's fields under `data`, its type beside them. */
type Logged<Vendor extends VendorName, Payload> = Payload extends { type: infer Type }
  ? { seq: number; at: string; source: EventSource; vendor: Vendor; type: Type; data: Omit<Payload, "type"> }
  : never;

/**
 * One event in the twin's log, typed by vendor and type: narrow on both and `data` is that event's record, named as the
 * vendor's docs name it (`if (event.vendor === "quickbooks" && event.type === "InvoiceCreated") event.data.invoice.DocNumber`).
 */
export type TwinLogEvent = Logged<"quickbooks", QboEventData> | Logged<"jobber", JobberEventData> | Logged<"housecallpro", HcpEventData>;

/** An event recorded since a checkpoint, with its one-line summary: what `changes()` and GET /_twin/checkpoints/:name/changes answer. */
export type Change = TwinLogEvent & { summary: string };

/** The events of one vendor (and one type), for narrowing a list of changes. */
export type EventOf<Vendor extends VendorName = VendorName, Type extends string = string> = Extract<
  TwinLogEvent,
  { vendor: Vendor; type: Type }
>;

/** GET /_twin: where the test world stands. */
export interface TwinStatus {
  company: WorldCompany;
  seed: number;
  scenario: string | null;
  twinTime: string;
  eventCount: number;
  vendors: VendorName[];
  authMode: AuthMode;
  activeFaults: string[];
  webhookSubscriptions: number;
  checkpoints: { name: string; time: string }[];
  upcoming: { at: string; vendor: VendorName; action: string; params: unknown }[];
}

/** GET /_twin/scenarios: a ready-made scenario, by the name loadScenario() takes. */
export interface ScenarioInfo {
  name: string;
  title: string;
  description: string;
}

/** GET /_twin/vendors: a vendor the twin serves, the actions runAction() can make happen in it, and the webhooks it sends. */
export interface VendorInfo {
  name: VendorName;
  pathPrefix: string;
  actions: string[];
  webhookTopics: string[];
}

/** GET /_twin/webhooks: the subscriptions, without their secrets, and the latest deliveries. */
export interface WebhookReport {
  subscriptions: Omit<WebhookSubscription, "clientSecret">[];
  deliveries: Delivery[];
}

/**
 * A scenario, as YAML or as this object: what to generate, when, which faults are on, and what happens as time passes.
 * README "Scenarios and faults" explains each part.
 */
export interface Scenario {
  name: string;
  description?: string;
  seed: number;
  startTime: string; // with a UTC offset: "2026-07-13T11:00:00Z"
  world?: {
    customers?: number;
    technicians?: number;
    drift?: { renamedInAccounting?: number; fieldServiceOnly?: number; accountingOnly?: number; inactiveInAccounting?: number };
  };
  auth?: AuthMode;
  faults?: FaultRule[];
  /** Each entry: `at` ("+90m", "08:00" business time, or a time with a UTC offset) and what each vendor does then. */
  timeline?: ({ at: string } & { [Vendor in VendorName]?: Record<string, unknown> })[];
}

/** OAuth tokens from a twin's own OAuth server, as connect() gets them. realmId is the QuickBooks company. */
export interface Tokens {
  accessToken: string;
  refreshToken: string;
  expiresIn: number; // seconds of twin time
  realmId?: string;
}
