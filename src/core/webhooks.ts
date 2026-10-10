import type { TwinEvent, VendorName } from "./types.ts";

/**
 * Webhooks: the twin telling your app what happened, the way the vendor would.
 *
 * Subscriptions are your app's settings (a URL, the topics it wants, and the secret deliveries are signed with),
 * so like OAuth grants they live outside the event log and survive reset and rewind. Deliveries are request
 * bookkeeping too: each recorded event a vendor has a topic for becomes one delivery per subscription that wants
 * it, sent after the API call or clock advance that caused it. A reset or rewind drops the ones still pending.
 *
 * Twin time decides when a delivery is due and when a failed one is tried again (each vendor's own policy); nothing
 * waits on the wall clock except the few seconds at most an app has to answer. This file is what a vendor and a
 * subscription contribute; webhook-dispatcher.ts queues the deliveries and sends them.
 */

/** Sends one delivery. Production: fetch. Tests: a function that answers like your app would. */
export type WebhookSender = (url: string, init: RequestInit & { headers: Record<string, string>; body: string }) => Promise<Response>;

export interface WebhookSubscription {
  vendor: VendorName;
  url: string;
  topics: string[];
  clientId: string; // the app, as the vendor knows it (its OAuth client_id)
  clientSecret: string; // what deliveries are signed with (Jobber: the app's OAuth client secret; QuickBooks: its verifier token)
}

/** Something that happened, as a vendor announces it: a topic and the record it is about. */
export interface WebhookNotification {
  topic: string;
  itemId: string;
  occurredAtMs: number;
}

/**
 * A notification as request() is given it: numbered once, for every subscription and every redelivery. Numbers are
 * never reused, resets and rewinds included, so a vendor can make each event's id from one.
 */
export interface NumberedNotification extends WebhookNotification {
  number: number;
}

/** What a vendor contributes: its topics, which events announce what, and how a delivery looks, is signed, and is sent. */
export interface VendorWebhooks<State = unknown> {
  topics: readonly string[];
  delivery: DeliveryPolicy;
  notify(event: TwinEvent, state: State): WebhookNotification[];
  request(
    notification: NumberedNotification,
    subscription: WebhookSubscription,
    state: State,
  ): { headers: Record<string, string>; body: string };
}

/** How a vendor delivers: how long an app has to answer, which answers count as accepted, and when to try again. */
export interface DeliveryPolicy {
  answerWithinMs: number;
  accepts(status: number): boolean;
  /** Twin time to wait after failed attempt number `attempt` (1 for the first), or null to give up. */
  retryAfterMs(attempt: number): number | null;
}

/**
 * How a delivery should misbehave, if at all: sent twice, or late. Fault rules decide (faults/webhook-faults.ts);
 * app.ts plugs them in, so core never needs to know faults exist.
 */
export type DeliveryFaults = (delivery: { vendor: VendorName; topic: string }) => {
  delayMs: number;
  delayedBy?: string; // the fault rule's name
  duplicatedBy?: string;
};

export interface Delivery {
  id: number;
  vendor: VendorName;
  topic: string;
  itemId: string;
  url: string;
  dueAt: string;
  attempts: number;
  status: "pending" | "delivered" | "failed";
  lastAnswer: string | null; // "HTTP 200", "HTTP 500", "no answer within 1 second", "network error"
  fault: string | null; // the fault rule that delayed or duplicated it
}
