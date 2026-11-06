import { createHmac } from "node:crypto";
import { stableUuid } from "../../core/ids.ts";
import { localTime } from "../../core/local-time.ts";
import type { VendorWebhooks, WebhookNotification } from "../../core/webhooks.ts";
import { asJobberEvent } from "./events.ts";
import type { JobberState } from "./types.ts";

/**
 * Jobber webhooks, as documented: https://developer.getjobber.com/docs/using_jobbers_api/setting_up_webhooks/
 *
 *   - Payload: { data: { webHookEvent: { topic, appId, accountId, itemId, occurredAt } } } as JSON (apps created
 *     after April 11, 2022), with `occurredAt` spelled that way (apps created after December 8, 2023). It "does not
 *     include the full object data": apps query the API for the itemId.
 *   - Signature: "a base64 encoded X-Jobber-Hmac-SHA256 header, which is generated using your app's OAuth client
 *     secret and the data sent in the webhook": HMAC-SHA256 over the raw JSON body.
 *   - "Adding a payment to an invoice fires INVOICE_UPDATE twice: once for the payment being applied and once for
 *     the invoice status changing", "typically about one second apart". Apps have to cope, so the twin does it.
 *
 * Only topics the docs name and the twin has events for are offered. The rest of WebHookTopicEnum isn't public.
 */
export const jobberWebhooks: VendorWebhooks<JobberState> = {
  topics: ["CLIENT_CREATE", "INVOICE_UPDATE"],

  // "Webhook requests must be responded to within 1 second of receipt." Jobber promises at-least-once delivery but
  // no retry schedule, so the twin tries five times, 1, 2, 3, then 4 minutes of twin time apart (see FIDELITY.md).
  delivery: {
    answerWithinMs: 1000,
    accepts: (status) => status >= 200 && status < 300,
    retryAfterMs: (attempt) => (attempt < 5 ? 60_000 * attempt : null),
  },

  notify(event): WebhookNotification[] {
    const data = asJobberEvent(event);
    const at = Date.parse(event.at);
    if (data.type === "ClientCreated") return [{ topic: "CLIENT_CREATE", itemId: data.client.id, occurredAtMs: at }];
    if (data.type !== "InvoiceUpdated") return [];
    const update = { topic: "INVOICE_UPDATE", itemId: data.invoice.id, occurredAtMs: at };
    // Paid by this very event: one update for the payment, and a second, a second later, for the status.
    return data.invoice.paidAt === event.at ? [update, { ...update, occurredAtMs: at + 1000 }] : [update];
  },

  request(notification, subscription, state) {
    const webHookEvent = {
      topic: notification.topic,
      appId: appIdFor(subscription.clientId), // Jobber gives each app a UUID; the twin has no app registry (FIDELITY.md)
      accountId: state.account.id,
      itemId: notification.itemId,
      occurredAt: localTime(notification.occurredAtMs, state.account.utcOffsetHours), // like the documented sample
    };
    const body = JSON.stringify({ data: { webHookEvent } });
    const signature = createHmac("sha256", subscription.clientSecret).update(body).digest("base64");
    return { body, headersAt: () => ({ "Content-Type": "application/json", "X-Jobber-Hmac-SHA256": signature }) };
  },
};

/**
 * The app's `appId`: stableUuid's hash of the client_id, with RFC 9562's version and variant bits set, so it is a
 * real UUID (version 8, the custom version, as a SHA-256 name-based UUID is: https://www.rfc-editor.org/rfc/rfc9562#section-5.8)
 * and apps that validate it as one accept it. Done here, not in stableUuid, so other vendors' ids don't change.
 */
function appIdFor(clientId: string): string {
  const hex = stableUuid(clientId);
  const variant = ((Number.parseInt(hex[19]!, 16) & 0x3) | 0x8).toString(16);
  return `${hex.slice(0, 14)}8${hex.slice(15, 19)}${variant}${hex.slice(20)}`;
}
