import { describe, expect, it, vi } from "vitest";
import type { TwinEvent } from "../src/core/types.ts";
import type { VendorTwin } from "../src/core/vendor-twin.ts";
import { WebhookDispatcher } from "../src/core/webhook-dispatcher.ts";

/**
 * How a round of deliveries goes out. Each app's URL gets its deliveries in order, one answer at a time, as Intuit
 * documents holding later events back for an app; different URLs don't wait for each other, so an app that stalls
 * only slows itself (and the control plane by its own timeouts, not everyone's).
 */
const vendor = {
  name: "jobber",
  webhooks: {
    topics: ["TOPIC"],
    delivery: { answerWithinMs: 1000, accepts: (status: number) => status === 200, retryAfterMs: () => 60_000 },
    notify: (event: TwinEvent) => [{ topic: "TOPIC", itemId: String(event.seq), occurredAtMs: 0 }],
    request: (notification: { itemId: string }) => ({ body: "{}", headersAt: () => ({ "X-Item": notification.itemId }) }),
  },
} as unknown as VendorTwin;

const STALLED = "http://stalled.example.com/hooks";
const PROMPT = "http://prompt.example.com/hooks";

/** A dispatcher whose sends are held until the test answers them. */
function heldDispatcher() {
  const sent: { url: string; itemId: string; answer: (status: number) => void }[] = [];
  const dispatcher = new WebhookDispatcher(
    (url, init) =>
      new Promise((resolve) => {
        const itemId = String(new Headers(init.headers).get("X-Item"));
        sent.push({ url, itemId, answer: (status) => resolve(new Response(null, { status })) });
      }),
  );
  const subscribe = (...urls: string[]) => {
    dispatcher.subscriptions = urls.map((url) => ({ vendor: "jobber", url, topics: ["TOPIC"], clientId: "a", clientSecret: "b" }));
  };
  const notice = (seq: number, nowMs = 0) => dispatcher.notice({ seq } as TwinEvent, vendor, {}, nowMs);
  return { dispatcher, sent, subscribe, notice };
}

describe("a round of webhook deliveries", () => {
  it("doesn't make one app wait while another app is slow to answer", async () => {
    const { dispatcher, sent, subscribe, notice } = heldDispatcher();
    subscribe(STALLED, PROMPT);
    notice(1);

    const round = dispatcher.deliverDue(0);
    await vi.waitFor(() => expect(sent.map((delivery) => delivery.url).sort()).toEqual([PROMPT, STALLED]));
    for (const delivery of sent) delivery.answer(200);
    await round;
  });

  it("doesn't make one app wait for another app that is still answering an earlier round", async () => {
    const { dispatcher, sent, subscribe, notice } = heldDispatcher();
    subscribe(STALLED);
    notice(1);
    const stalled = dispatcher.deliverDue(0);
    await vi.waitFor(() => expect(sent).toHaveLength(1));

    subscribe(PROMPT);
    notice(2);
    const prompt = dispatcher.deliverDue(0);
    await vi.waitFor(() => expect(sent.map((delivery) => delivery.url)).toEqual([STALLED, PROMPT]), { timeout: 200 });
    sent[1]!.answer(200);
    await prompt; // done, though the stalled app still hasn't answered
    sent[0]!.answer(200);
    await stalled;
  });

  it("sends one app its deliveries in order, each after the one before is answered", async () => {
    const { dispatcher, sent, subscribe, notice } = heldDispatcher();
    subscribe(PROMPT);
    notice(1);
    notice(2);

    const round = dispatcher.deliverDue(0);
    await vi.waitFor(() => expect(sent).toHaveLength(1));
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(sent.map((delivery) => delivery.itemId)).toEqual(["1"]); // the second waits for the first's answer
    sent[0]!.answer(500);
    await vi.waitFor(() => expect(sent.map((delivery) => delivery.itemId)).toEqual(["1", "2"]));
    sent[1]!.answer(200);
    await round;

    expect(dispatcher.deliveries().map(({ itemId, status }) => ({ itemId, status }))).toEqual([
      { itemId: "1", status: "pending" }, // to be tried again later in twin time
      { itemId: "2", status: "delivered" },
    ]);
  });

  it("stops sending an app the rest of a round once a reset forgets them", async () => {
    const { dispatcher, sent, subscribe, notice } = heldDispatcher();
    subscribe(PROMPT);
    notice(1);
    notice(2);

    const round = dispatcher.deliverDue(0);
    await vi.waitFor(() => expect(sent).toHaveLength(1));
    dispatcher.dropPending();
    sent[0]!.answer(200);
    await round;

    expect(sent).toHaveLength(1);
  });

  it("doesn't let a round queued before a reset send what was queued after it at the old twin time", async () => {
    const { dispatcher, sent, subscribe, notice } = heldDispatcher();
    subscribe(PROMPT);
    notice(1, 100);
    const first = dispatcher.deliverDue(100);
    await vi.waitFor(() => expect(sent).toHaveLength(1));
    notice(2, 100);
    const second = dispatcher.deliverDue(100); // queued behind the first, at twin time 100

    dispatcher.dropPending(); // a reset takes twin time back to 0
    notice(3, 50); // due at 50, not yet
    sent[0]!.answer(200);
    await Promise.all([first, second]);

    expect(sent.map((delivery) => delivery.itemId)).toEqual(["1"]);
    expect(dispatcher.deliveries().map(({ itemId, status }) => ({ itemId, status }))).toEqual([{ itemId: "3", status: "pending" }]);
  });
});
