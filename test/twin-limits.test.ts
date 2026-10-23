import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createApp } from "../src/app.ts";
import { advanceClock, setFaults, setWebhooks } from "../src/control/operations.ts";
import type { TwinEvent } from "../src/core/types.ts";
import type { VendorTwin } from "../src/core/vendor-twin.ts";
import { WebhookDispatcher } from "../src/core/webhook-dispatcher.ts";
import { setup } from "./helpers.ts";

/**
 * No request to the control plane can push twin time past what a date can hold, and nothing about webhooks, which
 * are bookkeeping, can break a write or stop later deliveries. Either used to leave the twin answering
 * "Invalid time value" until a reset, or crash the process.
 */

let logged: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  logged = vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => logged.mockRestore());

describe("how far twin time can move", () => {
  it("refuses to advance the clock more than ten years at once, and leaves it where it was", async () => {
    const { twin } = setup();
    const before = twin.clock.nowIso();
    await expect(advanceClock(twin, 1e12)).rejects.toThrow("ten years");
    expect(twin.clock.nowIso()).toBe(before);
  });

  it("still advances by zero minutes, which sends the webhooks already due", async () => {
    const { twin } = setup();
    await expect(advanceClock(twin, 0)).resolves.toMatchObject({ twinTime: twin.clock.nowIso() });
  });

  it("refuses a webhook delay longer than a week", () => {
    const rule = { name: "very-late", vendor: "jobber", webhook: "*", rate: 1, effect: { delayMs: 1e17 } };
    expect(() => setFaults(setup().twin, [rule])).toThrow(/delayMs/);
  });
});

describe("webhooks never break anything else", () => {
  it("answers a write that worked, even when queueing its webhook fails", async () => {
    const { twin, jobber } = setup();
    setWebhooks(twin, [{ vendor: "jobber", url: "http://localhost:1/hooks", topics: ["CLIENT_CREATE"], clientId: "a", clientSecret: "b" }]);
    twin.webhooks.faults = () => {
      throw new Error("a bug in webhook bookkeeping");
    };
    const response = await jobber(
      `mutation { clientCreate(input: { firstName: "Still", lastName: "Created" }) { client { name } userErrors { message } } }`,
    );
    expect(response.status).toBe(200);
    expect((await response.json()).data.clientCreate.client).toEqual({ name: "Still Created" });
    expect(String(logged.mock.calls[0]?.[0])).toContain("a bug in webhook bookkeeping");
  });

  it("keeps delivering after a round of deliveries fails, instead of failing every round after it", async () => {
    const vendor = {
      name: "jobber",
      webhooks: {
        topics: ["TOPIC"],
        delivery: {
          answerWithinMs: 1000,
          accepts: (status: number) => status === 200,
          retryAfterMs: () => {
            throw new Error("a bug in a retry policy");
          },
        },
        notify: (event: TwinEvent) => [{ topic: "TOPIC", itemId: String(event.seq), occurredAtMs: 0 }],
        request: () => ({ body: "{}", headersAt: () => ({}) }),
      },
    } as unknown as VendorTwin;
    const answers = [500, 200];
    const dispatcher = new WebhookDispatcher(async () => new Response(null, { status: answers.shift() }));
    dispatcher.subscriptions = [{ vendor: "jobber", url: "http://app.example.com", topics: ["TOPIC"], clientId: "a", clientSecret: "b" }];

    dispatcher.notice({ seq: 1 } as TwinEvent, vendor, {}, 0);
    await expect(dispatcher.deliverDue(0)).resolves.toBeUndefined();
    dispatcher.notice({ seq: 2 } as TwinEvent, vendor, {}, 0);
    await dispatcher.deliverDue(0);
    expect(dispatcher.deliveries().at(-1)).toMatchObject({ itemId: "2", status: "delivered" });
  });
});

describe("a twin built with an unusual start", () => {
  it("serves requests normally", async () => {
    const { app } = createApp({ startTime: "2030-01-01T00:00:00-08:00" });
    expect((await app.request("/_twin")).status).toBe(200);
  });
});

describe("a reset while a webhook is on its way", () => {
  it("forgets the delivery: if it fails, it isn't tried again about a world that no longer exists", async () => {
    const vendor = {
      name: "jobber",
      webhooks: {
        topics: ["TOPIC"],
        delivery: { answerWithinMs: 1000, accepts: (status: number) => status === 200, retryAfterMs: () => 10_000 },
        notify: (event: TwinEvent) => [{ topic: "TOPIC", itemId: String(event.seq), occurredAtMs: 0 }],
        request: () => ({ body: "{}", headersAt: () => ({}) }),
      },
    } as unknown as VendorTwin;
    let answer: (response: Response) => void = () => {};
    let sent = 0;
    const dispatcher = new WebhookDispatcher(() => {
      sent++;
      return new Promise((resolve) => {
        answer = resolve;
      });
    });
    dispatcher.subscriptions = [{ vendor: "jobber", url: "http://app.example.com", topics: ["TOPIC"], clientId: "a", clientSecret: "b" }];

    dispatcher.notice({ seq: 1 } as TwinEvent, vendor, {}, 0);
    const round = dispatcher.deliverDue(0);
    await vi.waitFor(() => expect(sent).toBe(1)); // on its way
    dispatcher.dropPending(); // what reset and rewind do
    answer(new Response(null, { status: 500 }));
    await round;

    await dispatcher.deliverDue(60_000); // long after the retry would have been due
    expect(sent).toBe(1);
    expect(dispatcher.deliveries()).toEqual([]);
  });
});
