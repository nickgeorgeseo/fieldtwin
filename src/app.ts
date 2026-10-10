import { Hono } from "hono";
import { controlRoutes } from "./control/http.ts";
import { Twin } from "./core/twin.ts";
import type { AuthMode } from "./core/types.ts";
import type { VendorTwin } from "./core/vendor-twin.ts";
import type { WebhookSender } from "./core/webhooks.ts";
import { faultMiddleware } from "./faults/fault-middleware.ts";
import { jobberTwin } from "./vendors/jobber/index.ts";
import { quickbooksTwin } from "./vendors/quickbooks/index.ts";

/** Every vendor twin this build serves. Adding a vendor = one import and one entry here. */
export const ALL_VENDORS: VendorTwin[] = [quickbooksTwin, jobberTwin];

const prefixes = ALL_VENDORS.map((vendor) => vendor.pathPrefix);
if (new Set(prefixes).size !== prefixes.length) throw new Error(`Two vendors share a pathPrefix: ${prefixes.join(", ")}`);

export interface AppOptions {
  seed?: number;
  startTime?: string;
  auth?: AuthMode; // "any-token" (default) or "oauth"
  sendWebhook?: WebhookSender; // how webhook deliveries reach your app (fetch by default); tests answer them in process
}

/** Builds the twin and the HTTP app around it. Tests use this directly, no network needed. */
export function createApp(options: AppOptions = {}) {
  const twin = new Twin({
    seed: options.seed ?? 42,
    startTime: options.startTime ?? "2026-07-13T11:00:00.000Z",
    auth: options.auth,
    vendors: ALL_VENDORS,
    sendWebhook: options.sendWebhook,
  });

  const app = new Hono();
  app.route("/", controlRoutes(twin));
  for (const vendor of ALL_VENDORS) {
    // Faults are scoped to the vendor's own URL prefix, so a QuickBooks fault never hits Jobber.
    app.use(`${vendor.pathPrefix}/*`, faultMiddleware(twin, vendor));
    // What a request recorded may be news to a webhook subscriber: send it once the request has been handled.
    app.use(`${vendor.pathPrefix}/*`, async (_c, next) => {
      await next();
      void twin.deliverWebhooks();
    });
    app.route("/", vendor.routes(twin));
  }

  return { app, twin };
}
