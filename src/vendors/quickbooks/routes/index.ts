import { Hono } from "hono";
import { checkBearer } from "../../../core/auth.ts";
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
    await next();
  });

  customerRoutes(app, twin);
  itemRoutes(app, twin);
  invoiceRoutes(app, twin);
  paymentRoutes(app, twin);
  queryRoutes(app, twin);
  cdcRoutes(app, twin);
  return app;
}

const AUTH_PROBLEMS = {
  missing: "Send an Authorization: Bearer <access token> header.",
  unknown: "Access token invalid. Get one from the OAuth 2.0 token endpoint.",
  expired: "Access token expired. Use your refresh token to get a new one.",
  revoked: "Access token revoked. The app must be authorized again.",
};
