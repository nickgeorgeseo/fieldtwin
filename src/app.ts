import { type ErrorHandler, Hono } from "hono";
import { controlRoutes } from "./control/http.ts";
import { Twin } from "./core/twin.ts";
import type { AuthMode } from "./core/types.ts";
import type { VendorTwin } from "./core/vendor-twin.ts";
import type { WebhookSender } from "./core/webhooks.ts";
import { faultMiddleware } from "./faults/fault-middleware.ts";
import { webhookFaults } from "./faults/webhook-faults.ts";
import { jobberTwin } from "./vendors/jobber/index.ts";
import { ACTIVE_VERSIONS } from "./vendors/jobber/versions.ts";
import { quickbooksTwin } from "./vendors/quickbooks/index.ts";
import { TWIN_REALM_ID } from "./vendors/quickbooks/seed.ts";

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

  twin.webhooks.faults = webhookFaults(twin); // fault rules with `webhook:` make deliveries misbehave

  const app = new Hono();
  app.get("/", (c) => c.json(startHere(twin, new URL(c.req.url).origin)));
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
  app.onError(answerUnexpectedErrors(twin));

  return { app, twin };
}

/** What GET / answers: where everything is, for whoever opens the twin's address in a browser first. */
function startHere(twin: Twin, origin: string) {
  return {
    fieldtwin: `${twin.world.company.name} is open for business`,
    quickbooks: { baseUrl: origin, realmId: TWIN_REALM_ID, try: `GET ${origin}/v3/company/${TWIN_REALM_ID}/customer/1` },
    jobber: { graphql: `POST ${origin}/api/graphql`, headers: { "X-JOBBER-GRAPHQL-VERSION": ACTIVE_VERSIONS[0] } },
    auth:
      twin.authMode === "any-token"
        ? "Any bearer token works: Authorization: Bearer dev"
        : "Get a token from each vendor's OAuth endpoints; the docs show how",
    controlPlane: `GET ${origin}/_twin`,
    docs: "https://github.com/nickgeorgeseo/fieldtwin#readme",
  };
}

/**
 * The last line of defense. An error nothing expected is a bug in the twin: log it with its stack, and answer a
 * 500 in the vendor's own error format, so the client sees a server error it can parse rather than plain text.
 */
export function answerUnexpectedErrors(twin: Twin): ErrorHandler {
  return (error, c) => {
    console.error(`fieldtwin: unexpected error answering ${c.req.method} ${c.req.path}: ${error.stack ?? error.message}`);
    const message = "The twin hit an unexpected error. This is a bug in fieldtwin: the twin's log has the details.";
    const vendor = twin
      .vendorNames()
      .map((name) => twin.vendor(name))
      .find((candidate) => c.req.path.startsWith(`${candidate.pathPrefix}/`));
    return c.json((vendor ? vendor.errorBody(500, message, twin) : { error: message }) as object, 500);
  };
}
