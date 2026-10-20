import { Hono } from "hono";
import type { Twin } from "../../../core/twin.ts";
import { AUTH_PROBLEMS, checkCredentials } from "../auth.ts";
import { hcpError, hcpUnauthorized } from "../errors.ts";
import { housecallproOAuthRoutes } from "../oauth.ts";
import { addressRoutes } from "./addresses.ts";
import { HCP } from "./base.ts";
import { companyRoutes } from "./company.ts";
import { customerRoutes } from "./customers.ts";
import { employeeRoutes } from "./employees.ts";
import { estimateRoutes } from "./estimates.ts";
import { invoiceRoutes } from "./invoices.ts";
import { jobWriteRoutes } from "./job-writes.ts";
import { jobRoutes } from "./jobs.ts";
import { locationCheck } from "./locations.ts";

/**
 * Housecall Pro's public API, v1, served under /housecallpro (base.ts says why).
 * Reference: https://docs.housecallpro.com/docs/housecall-public-api/a4ca20a18010c-housecall-v1-api
 */
export function housecallproRoutes(twin: Twin): Hono {
  const app = new Hono();

  // First, so the credential check below never runs for them: these are how an app gets its credentials.
  housecallproOAuthRoutes(app, twin);

  // "Housecall Pro expects the OAuth 2.0 access token or API key to be included in all authenticated API requests."
  app.use(`${HCP}/*`, async (c, next) => {
    const auth = checkCredentials(twin, c.req.header("Authorization"));
    if ("problem" in auth) return c.json(hcpUnauthorized(AUTH_PROBLEMS[auth.problem]), 401);
    await next();
  });
  app.use(`${HCP}/*`, locationCheck(twin));

  companyRoutes(app, twin);
  customerRoutes(app, twin);
  addressRoutes(app, twin);
  employeeRoutes(app, twin);
  jobRoutes(app, twin);
  jobWriteRoutes(app, twin);
  invoiceRoutes(app, twin);
  estimateRoutes(app, twin);

  // Anything else is an endpoint the twin doesn't model yet. 501, which the real API never sends, so a client can't
  // mistake it for "that record doesn't exist" (a 404) or a request it should fix (a 400 or 422).
  app.all(`${HCP}/*`, (c) => {
    const path = c.req.path.slice(HCP.length) || "/";
    const slash = path.length > 1 && path.endsWith("/") ? ` Its paths take no trailing slash: try ${path.replace(/\/+$/, "")}.` : "";
    const detail = `The twin doesn't model ${c.req.method} ${path} yet.${slash} It serves ${SERVED}; see FIDELITY.md.`;
    return c.json(hcpError(detail), 501);
  });
  return app;
}

// Every operation the twin serves, so a client can tell at once whether the one it called is coming.
const SERVED = [
  "GET /company",
  "GET, POST /customers",
  "GET, PUT /customers/{id}",
  "GET, POST /customers/{id}/addresses",
  "GET /customers/{id}/addresses/{address_id}",
  "GET /employees",
  "GET, POST /jobs",
  "GET /jobs/{id}",
  "GET /jobs/{id}/line_items",
  "GET /jobs/{id}/appointments",
  "GET /jobs/{id}/invoices",
  "GET /invoices",
  "GET /api/invoices/{uuid}",
  "GET /estimates",
  "GET /estimates/{id}",
  "GET /estimates/{id}/options/{option_id}/line_items",
].join("; ");
