import { createHash, createHmac } from "node:crypto";
import { stableUuid } from "../../core/ids.ts";
import type { VendorWebhooks, WebhookNotification } from "../../core/webhooks.ts";
import { asQboEvent } from "./events.ts";
import type { QboEntityName, QboState } from "./types.ts";

/**
 * QuickBooks webhooks, as documented: https://developer.intuit.com/app/developer/qbo/docs/develop/webhooks/configure-webhooks
 *
 *   - Payload: CloudEvents, the only format since Intuit retired the old `eventNotifications` one on July 31, 2026.
 *     A JSON array of events `{ specversion, id, source, type, datacontenttype, time, intuitentityid,
 *     intuitaccountid, data }`, with `type` as "namespace.entitytype.eventname.version" (`qbo.customer.created.v1`).
 *     It names the entity, not its contents: apps read it from the API (or CDC).
 *   - Signature: "Hash the notification payload with HMAC_SHA256_ALGORITHM using the <verifier token> value as the
 *     key" and compare with the `intuit-signature` header; the docs' Java example base64-encodes the hash.
 *   - Delivery (https://developer.intuit.com/app/developer/qbo/docs/develop/webhooks/best-practices): "respond to
 *     notifications with an HTTP 200 status within 3 seconds", or the event is retried "at the following intervals:
 *     10s, 20s, 30s, 5m, 20m, 2h, 4h, 6h, and then on stays at 6-hour intervals".
 *
 * Subscriptions name the CloudEvents types they want. Only types the twin has events for are offered: entities
 * the docs list as supported, created or updated through the API (deletes, merges, voids, and emails aren't modeled).
 */
const TOPICS: Record<string, QboEntityName> = {
  "qbo.customer.created.v1": "Customer",
  "qbo.customer.updated.v1": "Customer",
  "qbo.invoice.created.v1": "Invoice",
  "qbo.invoice.updated.v1": "Invoice",
  "qbo.payment.created.v1": "Payment",
};

const RETRY_INTERVALS_MS = [10, 20, 30, 5 * 60, 20 * 60, 2 * 3600, 4 * 3600, 6 * 3600].map((seconds) => seconds * 1000);
const EVERY_6_HOURS_MS = 6 * 3600 * 1000;
const MAX_ATTEMPTS = 20; // Intuit doesn't say when it stops retrying; about three days (see FIDELITY.md)

export const quickbooksWebhooks: VendorWebhooks<QboState> = {
  topics: Object.keys(TOPICS),

  delivery: {
    answerWithinMs: 3000,
    accepts: (status) => status === 200, // "an HTTP 200 status", as the docs word it
    retryAfterMs: (attempt) => (attempt < MAX_ATTEMPTS ? (RETRY_INTERVALS_MS[attempt - 1] ?? EVERY_6_HOURS_MS) : null),
  },

  notify(event): WebhookNotification[] {
    const data = asQboEvent(event);
    const announce = (topic: string, itemId: string) => [{ topic, itemId, occurredAtMs: Date.parse(event.at) }];
    switch (data.type) {
      case "CustomerCreated":
        return announce("qbo.customer.created.v1", data.customer.Id);
      case "CustomerUpdated":
        return announce("qbo.customer.updated.v1", data.customer.Id);
      case "InvoiceCreated":
        return announce("qbo.invoice.created.v1", data.invoice.Id);
      case "InvoiceUpdated": // includes the update a payment makes to each invoice it pays
        return announce("qbo.invoice.updated.v1", data.invoice.Id);
      case "PaymentCreated":
        return announce("qbo.payment.created.v1", data.payment.Id);
      default:
        return [];
    }
  },

  request(notification, subscription, state) {
    const entity = TOPICS[notification.topic];
    const event = {
      specversion: "1.0",
      // "Unique ID of the event." The docs' newer samples end it with the entity and its Id. Every delivery of one
      // event (retries, duplicates) carries the same id, so apps can tell a repeat from a new change.
      id: `${stableUuid(`${state.realmId}/${notification.number}`)}-${entity}-${notification.itemId}`,
      // "GUID value. Can be ignored." Shaped like the docs' sample, derived from the app's client_id (FIDELITY.md).
      source: `intuit.${createHash("sha256").update(subscription.clientId).digest("base64")}`,
      type: notification.topic,
      datacontenttype: "application/json",
      time: new Date(notification.occurredAtMs).toISOString(), // "RFC 3339 (ISO 8601) format at UTC+0"
      intuitentityid: notification.itemId,
      intuitaccountid: state.realmId,
      data: {}, // "Can be ignored if empty." Creates and updates carry nothing in it
    };
    const body = JSON.stringify([event]);
    const signature = createHmac("sha256", subscription.clientSecret).update(body).digest("base64");
    return { body, headersAt: () => ({ "content-type": "application/json; charset=utf-8", "intuit-signature": signature }) };
  },
};
