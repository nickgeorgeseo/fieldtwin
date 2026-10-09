import { Hono } from "hono";
import type { Twin } from "../../../core/twin.ts";
import { qboErrors } from "../errors.ts";
import type { QboState } from "../types.ts";
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

  // Every request needs a bearer token (the twin accepts any token until the OAuth twin lands),
  // and every QuickBooks URL names a company ("realm"). The twin serves exactly one.
  app.use(`${COMPANY}/*`, async (c, next) => {
    if (!c.req.header("Authorization")?.startsWith("Bearer ")) {
      return c.json(qboErrors.notAuthenticated("Send an Authorization: Bearer <access token> header.", now()), 401);
    }
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
  return app;
}
