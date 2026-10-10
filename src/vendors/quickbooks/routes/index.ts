import { Hono } from "hono";
import { checkBearer } from "../../../core/auth.ts";
import { SlidingWindowLimit } from "../../../core/sliding-window.ts";
import type { Twin } from "../../../core/twin.ts";
import { qboErrors } from "../errors.ts";
import { QBO_OAUTH_POLICY, quickbooksOAuthRoutes } from "../oauth.ts";
import type { QboState } from "../types.ts";
import { cdcRoutes } from "./cdc.ts";
import { customerRoutes } from "./customer.ts";
import { COMPANY } from "./entity.ts";
import { invoiceRoutes } from "./invoice.ts";
import { itemRoutes } from "./item.ts";
import { paymentRoutes } from "./payment.ts";
import { queryRoutes } from "./query.ts";

/**
 * QuickBooks Online Accounting API, v3.
 * Real base URL: https://quickbooks.api.intuit.com/v3/company/{realmId}/...
 * Point your client at http://localhost:4010 instead and keep the rest of the path the same.
 * URI formats: https://developer.intuit.com/app/developer/qbo/docs/learn/rest-api-features
 */
export function quickbooksRoutes(twin: Twin): Hono {
  const app = new Hono();
  const realmId = () => twin.state<QboState>("quickbooks").realmId;
  const now = () => twin.clock.nowIso();

  quickbooksOAuthRoutes(app, twin);

  // Every request needs a bearer token: any token in any-token mode, or one the twin's OAuth server
  // issued and hasn't expired in oauth mode. And every QuickBooks URL names a company ("realm").
  app.use(`${COMPANY}/*`, async (c, next) => {
    const auth = checkBearer(twin, "quickbooks", QBO_OAUTH_POLICY, c.req.header("Authorization"));
    if ("problem" in auth) return c.json(qboErrors.notAuthenticated(AUTH_PROBLEMS[auth.problem], now()), 401);
    if (c.req.param("realmId") !== realmId()) {
      return c.json(qboErrors.wrongRealm(c.req.param("realmId") ?? "", realmId(), now()), 403);
    }
    // "500 requests per minute per realm ID", whichever app sends them, and on a 429 "wait 60 seconds before
    // retrying the request": https://developer.intuit.com/app/developer/qbo/docs/learn/limits-and-throttles
    // A sliding minute makes waiting 60 seconds exactly enough, and retrying sooner not (see FIDELITY.md).
    const limit = twin.rateLimit(`quickbooks:${realmId()}`, () => new SlidingWindowLimit(REQUESTS_PER_REALM));
    if (!limit.take(twin.clock.nowMs())) return c.json(qboErrors.throttled(THROTTLED, now()), 429);
    await next();
  });

  customerRoutes(app, twin);
  itemRoutes(app, twin);
  invoiceRoutes(app, twin);
  paymentRoutes(app, twin);
  queryRoutes(app, twin);
  cdcRoutes(app, twin);

  // Anything else under the company is an entity or report the twin doesn't model yet: say so in QuickBooks' format.
  app.all(`${COMPANY}/*`, (c) => {
    const [, , , , what = ""] = c.req.path.split("/"); // /v3/company/{realmId}/{what}/...
    const detail = `The twin doesn't model ${c.req.method} ${what} yet. It serves ${SERVED}.`;
    return c.json(qboErrors.unsupportedOperation(detail, now()), 400);
  });
  return app;
}

const SERVED = "customer, item, invoice, payment (by Id and through query), query, and cdc; see FIDELITY.md";

const REQUESTS_PER_REALM = { requests: 500, periodMs: 60_000 };
const THROTTLED = "This company has had 500 requests in the last minute. Wait 60 seconds before retrying the request.";

const AUTH_PROBLEMS = {
  missing: "Send an Authorization: Bearer <access token> header.",
  unknown: "Access token invalid. Get one from the OAuth 2.0 token endpoint.",
  expired: "Access token expired. Use your refresh token to get a new one.",
  revoked: "Access token revoked. The app must be authorized again.",
};
