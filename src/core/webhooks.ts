import type { TwinEvent, VendorName } from "./types.ts";
import type { VendorTwin } from "./vendor-twin.ts";

/**
 * Webhooks: the twin telling your app what happened, the way the vendor would.
 *
 * Subscriptions are your app's settings (a URL, the topics it wants, and the secret deliveries are signed with),
 * so like OAuth grants they live outside the event log and survive reset and rewind. Deliveries are request
 * bookkeeping too: each recorded event a vendor has a topic for becomes one delivery per subscription that wants
 * it, sent after the API call or clock advance that caused it. A reset or rewind drops the ones still pending.
 *
 * Twin time decides when a delivery is due and when a failed one is tried again; nothing waits on the wall
 * clock except the one second an app has to answer.
 */

/** Sends one delivery. Production: fetch. Tests: a function that answers like your app would. */
export type WebhookSender = (url: string, init: RequestInit & { headers: Record<string, string>; body: string }) => Promise<Response>;

export interface WebhookSubscription {
  vendor: VendorName;
  url: string;
  topics: string[];
  clientId: string; // the app, as the vendor knows it (Jobber: its OAuth client_id)
  clientSecret: string; // what deliveries are signed with (Jobber: the app's OAuth client secret)
}

/** Something that happened, as a vendor announces it: a topic and the record it is about. */
export interface WebhookNotification {
  topic: string;
  itemId: string;
  occurredAtMs: number;
}

/** What a vendor contributes: its topics, which events announce what, and how a delivery looks and is signed. */
export interface VendorWebhooks<State = unknown> {
  topics: readonly string[];
  notify(event: TwinEvent, state: State): WebhookNotification[];
  request(
    notification: WebhookNotification,
    subscription: WebhookSubscription,
    state: State,
  ): { headers: Record<string, string>; body: string };
}

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
}

const ANSWER_WITHIN_MS = 1000; // "Webhook requests must be responded to within 1 second of receipt."
const MAX_ATTEMPTS = 5; // not documented; see FIDELITY.md
const RETRY_AFTER_MS = 60_000; // not documented: a minute of twin time, longer each attempt
const KEEP_DELIVERIES = 200;

interface Queued extends Delivery {
  dueMs: number;
  request: { headers: Record<string, string>; body: string };
}

export class WebhookDispatcher {
  subscriptions: WebhookSubscription[] = [];
  private queue: Queued[] = [];
  private recent: Queued[] = [];
  private nextId = 1;
  private running: Promise<void> = Promise.resolve();

  constructor(private readonly send: WebhookSender) {}

  /** Queue a delivery to every subscription that wants what this event announces. */
  notice(event: TwinEvent, vendor: VendorTwin, state: unknown, nowMs: number): void {
    if (!vendor.webhooks) return;
    for (const notification of vendor.webhooks.notify(event, state)) {
      for (const subscription of this.subscriptions) {
        if (subscription.vendor !== vendor.name || !subscription.topics.includes(notification.topic)) continue;
        const queued: Queued = {
          id: this.nextId++,
          vendor: vendor.name,
          topic: notification.topic,
          itemId: notification.itemId,
          url: subscription.url,
          dueMs: nowMs,
          dueAt: new Date(nowMs).toISOString(),
          attempts: 0,
          status: "pending",
          lastAnswer: null,
          request: vendor.webhooks.request(notification, subscription, state),
        };
        this.queue.push(queued);
        this.recent = [...this.recent, queued].slice(-KEEP_DELIVERIES);
      }
    }
  }

  /** Send everything due by `nowMs`, in order. Rounds never overlap; failures are queued again for later. */
  deliverDue(nowMs: number): Promise<void> {
    this.running = this.running.then(() => this.sendDue(nowMs));
    return this.running;
  }

  /** Resolves when the deliveries started so far have been answered (or given up on). */
  idle(): Promise<void> {
    return this.running;
  }

  /** The latest deliveries, oldest first, without their payloads. */
  deliveries(): Delivery[] {
    return this.recent.map(({ dueMs: _dueMs, request: _request, ...delivery }) => ({ ...delivery }));
  }

  /** Forget deliveries not yet made: the events behind them were reset or rewound away. */
  dropPending(): void {
    this.queue = [];
    this.recent = this.recent.filter((delivery) => delivery.status !== "pending");
  }

  private async sendDue(nowMs: number): Promise<void> {
    for (;;) {
      const due = this.queue.filter((delivery) => delivery.dueMs <= nowMs).sort((a, b) => a.dueMs - b.dueMs || a.id - b.id)[0];
      if (!due) return;
      this.queue = this.queue.filter((delivery) => delivery !== due);
      due.attempts++;
      due.lastAnswer = await this.attempt(due);
      if (due.lastAnswer.startsWith("HTTP 2")) {
        due.status = "delivered";
      } else if (due.attempts < MAX_ATTEMPTS) {
        due.dueMs = nowMs + RETRY_AFTER_MS * due.attempts;
        due.dueAt = new Date(due.dueMs).toISOString();
        this.queue.push(due);
      } else {
        due.status = "failed";
      }
    }
  }

  private async attempt(delivery: Queued): Promise<string> {
    try {
      const response = await this.send(delivery.url, {
        method: "POST",
        ...delivery.request,
        signal: AbortSignal.timeout(ANSWER_WITHIN_MS),
      });
      await response.body?.cancel();
      return `HTTP ${response.status}`;
    } catch (error) {
      return error instanceof Error && error.name === "TimeoutError" ? "no answer within 1 second" : "network error";
    }
  }
}
