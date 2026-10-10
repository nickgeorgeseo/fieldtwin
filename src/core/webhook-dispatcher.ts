import type { TwinEvent } from "./types.ts";
import type { VendorTwin } from "./vendor-twin.ts";
import type { Delivery, DeliveryFaults, DeliveryPolicy, WebhookSender, WebhookSubscription } from "./webhooks.ts";

/**
 * Queues webhook deliveries as events are recorded, and sends them when they are due in twin time: each URL its
 * deliveries in order, URLs in parallel, failed ones again on the vendor's schedule. See webhooks.ts for what a
 * vendor contributes.
 */
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
