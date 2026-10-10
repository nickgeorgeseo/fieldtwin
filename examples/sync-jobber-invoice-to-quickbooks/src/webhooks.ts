import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Receiving Jobber webhooks: https://developer.getjobber.com/docs/using_jobbers_api/setting_up_webhooks/
 *
 *   - Verify first. "Each request will include a base64 encoded X-Jobber-Hmac-SHA256 header, which is generated
 *     using your app's OAuth client secret and the data sent in the webhook." Compare in constant time.
 *   - Answer at once. "Webhook requests must be responded to within 1 second of receipt", so the handler only
 *     verifies and queues; the sync happens in the background (invoice-queue.ts).
 *   - Expect repeats and disorder. Delivery is at least once, a payment fires INVOICE_UPDATE twice, and the payload
 *     names the record without its data, so the queue fetches the invoice as it is now and the sync is idempotent.
 *
 * The handler takes a standard Request and returns a Response, so it mounts in any framework that speaks them
 * (Hono, Next.js route handlers, Cloudflare Workers) or in Node through @hono/node-server, as main.ts does.
 */

export interface JobberWebhookEvent {
  topic: string;
  appId: string;
  accountId: string;
  itemId: string;
  occurredAt: string;
}

/** A webhook is a few hundred bytes. Anything far bigger is refused before it is read or hashed. */
const MAX_BODY_BYTES = 64 * 1024;

export function jobberWebhookHandler(options: { clientSecret: string; onEvent: (event: JobberWebhookEvent) => void }) {
  return async (request: Request): Promise<Response> => {
    if (Number(request.headers.get("Content-Length") ?? 0) > MAX_BODY_BYTES) return new Response("too large", { status: 413 });
    // The raw bytes: the signature is over exactly these, and decoding first could change them (a byte-order mark).
    const body = Buffer.from(await request.arrayBuffer());
    if (body.length > MAX_BODY_BYTES) return new Response("too large", { status: 413 });
    if (!verifyJobberSignature(body, request.headers.get("X-Jobber-Hmac-SHA256"), options.clientSecret)) {
      return new Response("signature doesn't verify", { status: 401 });
    }
    let payload: { data?: { webHookEvent?: JobberWebhookEvent } };
    try {
      payload = JSON.parse(body.toString("utf8").replace(/^\uFEFF/, ""));
    } catch {
      return new Response("not JSON", { status: 400 });
    }
    const event = payload.data?.webHookEvent;
    if (!event?.topic || !event.itemId) return new Response("not a webhook event", { status: 400 });
    options.onEvent(event);
    return new Response(null, { status: 200 });
  };
}

/** Whether a body was signed with this client secret, compared in constant time like the docs' examples. */
export function verifyJobberSignature(body: string | Buffer, signature: string | null, clientSecret: string): boolean {
  if (!signature) return false;
  const expected = Buffer.from(createHmac("sha256", clientSecret).update(body).digest("base64"));
  const given = Buffer.from(signature);
  return expected.length === given.length && timingSafeEqual(expected, given);
}
