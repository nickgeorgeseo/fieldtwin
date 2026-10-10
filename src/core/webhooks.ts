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
 * Twin time decides when a delivery is due and when a failed one is tried again (each vendor's own policy); nothing
 * waits on the wall clock except the few seconds at most an app has to answer.
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

const KEEP_DELIVERIES = 200;

interface Queued extends Delivery {
  dueMs: number;
  request: { headers: Record<string, string>; body: string };
  policy: DeliveryPolicy;
}

export class WebhookDispatcher {
  subscriptions: WebhookSubscription[] = [];
  faults: DeliveryFaults | undefined;
  private queue: Queued[] = [];
  private recent: Queued[] = [];
  private nextId = 1;
  private nextNumber = 1;
  private running: Promise<void> = Promise.resolve();
  private generation = 0; // bumped by dropPending(), so a delivery already on its way when the world changed is forgotten

  constructor(private readonly send: WebhookSender) {}

  /** Queue a delivery to every subscription that wants what this event announces. */
  notice(event: TwinEvent, vendor: VendorTwin, state: unknown, nowMs: number): void {
    if (!vendor.webhooks) return;
    for (const announced of vendor.webhooks.notify(event, state)) {
      const notification = { ...announced, number: this.nextNumber++ };
      for (const subscription of this.subscriptions) {
        if (subscription.vendor !== vendor.name || !subscription.topics.includes(notification.topic)) continue;
        const request = vendor.webhooks.request(notification, subscription, state);
        const fault = this.faults?.({ vendor: vendor.name, topic: notification.topic }) ?? { delayMs: 0 };
        const { delivery: policy } = vendor.webhooks;
        const delivery = { vendor: vendor.name, topic: notification.topic, itemId: notification.itemId, url: subscription.url, policy };
        this.enqueue({ ...delivery, request, dueMs: nowMs + fault.delayMs, fault: fault.delayedBy ?? null });
        if (fault.duplicatedBy) this.enqueue({ ...delivery, request, dueMs: nowMs + fault.delayMs, fault: fault.duplicatedBy });
      }
    }
  }

  private enqueue(delivery: Pick<Queued, "vendor" | "topic" | "itemId" | "url" | "policy" | "request" | "dueMs" | "fault">): void {
    const { request, fault } = delivery;
    const queued: Queued = {
      ...delivery,
      id: this.nextId++,
      dueAt: new Date(delivery.dueMs).toISOString(),
      attempts: 0,
      status: "pending",
      lastAnswer: null,
      // An injected fault says so, like X-Twin-Fault on API answers. The signature covers the body only.
      request: fault ? { ...request, headers: { ...request.headers, "X-Twin-Fault": fault } } : request,
    };
    this.queue.push(queued);
    this.recent = [...this.recent, queued].slice(-KEEP_DELIVERIES);
  }

  /**
   * Send everything due by `nowMs`. Rounds never overlap; failed deliveries are queued again for later.
   * This never rejects: a round that throws (a bug) is logged, and the next round runs as usual.
   */
  deliverDue(nowMs: number): Promise<void> {
    this.running = this.running.then(() =>
      this.sendDue(nowMs).catch((error: Error) =>
        console.error(`fieldtwin: a round of webhook deliveries failed: ${error.stack ?? error}`),
      ),
    );
    return this.running;
  }

  /** Resolves when the deliveries started so far have been answered (or given up on). */
  idle(): Promise<void> {
    return this.running;
  }

  /** The latest deliveries, oldest first, without their payloads. */
  deliveries(): Delivery[] {
    return this.recent.map(({ dueMs: _dueMs, request: _request, policy: _policy, ...delivery }) => ({ ...delivery }));
  }

  /** Forget deliveries not yet made, and any on their way: the events behind them were reset or rewound away. */
  dropPending(): void {
    this.generation++;
    this.queue = [];
    this.recent = this.recent.filter((delivery) => delivery.status !== "pending");
  }

  /**
   * Each URL gets its due deliveries in order, the next once the one before is answered (Intuit holds an app's later
   * events back the same way). URLs don't wait for each other, so an app that stalls only delays itself.
   */
  private async sendDue(nowMs: number): Promise<void> {
    const generation = this.generation;
    const due = this.queue.filter((delivery) => delivery.dueMs <= nowMs).sort((a, b) => a.dueMs - b.dueMs || a.id - b.id);
    this.queue = this.queue.filter((delivery) => delivery.dueMs > nowMs);
    const byUrl = new Map<string, Queued[]>();
    for (const delivery of due) byUrl.set(delivery.url, [...(byUrl.get(delivery.url) ?? []), delivery]);
    await Promise.all([...byUrl.values()].map((deliveries) => this.sendInOrder(deliveries, nowMs, generation)));
  }

  private async sendInOrder(deliveries: Queued[], nowMs: number, generation: number): Promise<void> {
    for (const due of deliveries) {
      due.attempts++;
      const { answer, accepted } = await this.attempt(due);
      if (this.generation !== generation) return; // reset or rewound while it was on its way: neither retry nor go on
      due.lastAnswer = answer;
      const retryAfterMs = accepted ? null : due.policy.retryAfterMs(due.attempts);
      if (accepted) {
        due.status = "delivered";
      } else if (retryAfterMs !== null) {
        due.dueMs = nowMs + retryAfterMs;
        due.dueAt = new Date(due.dueMs).toISOString();
        this.queue.push(due);
      } else {
        due.status = "failed";
      }
    }
  }

  private async attempt(delivery: Queued): Promise<{ answer: string; accepted: boolean }> {
    const { answerWithinMs, accepts } = delivery.policy;
    try {
      const response = await this.send(delivery.url, {
        method: "POST",
        ...delivery.request,
        signal: AbortSignal.timeout(answerWithinMs),
      });
      await response.body?.cancel();
      return { answer: `HTTP ${response.status}`, accepted: accepts(response.status) };
    } catch (error) {
      const seconds = answerWithinMs / 1000;
      const timedOut = error instanceof Error && error.name === "TimeoutError";
      return { answer: timedOut ? `no answer within ${seconds} second${seconds === 1 ? "" : "s"}` : "network error", accepted: false };
    }
  }
}
