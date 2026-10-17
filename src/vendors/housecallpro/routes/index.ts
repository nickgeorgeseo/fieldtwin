import { Hono } from "hono";
import type { Twin } from "../../../core/twin.ts";
import { AUTH_PROBLEMS, checkCredentials } from "../auth.ts";
import { hcpError, hcpUnauthorized } from "../errors.ts";
import { addressRoutes } from "./addresses.ts";
import { HCP } from "./base.ts";
import { companyRoutes } from "./company.ts";
import { customerRoutes } from "./customers.ts";

/**
 * Housecall Pro's public API, v1, served under /housecallpro (base.ts says why).
 * Reference: https://docs.housecallpro.com/docs/housecall-public-api/a4ca20a18010c-housecall-v1-api
 */
export function housecallproRoutes(twin: Twin): Hono {
  const app = new Hono();

  // "Housecall Pro expects the OAuth 2.0 access token or API key to be included in all authenticated API requests."
  app.use(`${HCP}/*`, async (c, next) => {
    const auth = checkCredentials(twin, c.req.header("Authorization"));
    if ("problem" in auth) return c.json(hcpUnauthorized(AUTH_PROBLEMS[auth.problem]), 401);
    await next();
  });

  companyRoutes(app, twin);
  customerRoutes(app, twin);
  addressRoutes(app, twin);

  // Anything else is an endpoint the twin doesn't model yet. 501, which the real API never sends, so a client can't
  // mistake it for "that record doesn't exist" (a 404) or a request it should fix (a 400 or 422).
  app.all(`${HCP}/*`, (c) => {
    const detail = `The twin doesn't model ${c.req.method} ${c.req.path.slice(HCP.length)} yet. It serves ${SERVED}; see FIDELITY.md.`;
    return c.json(hcpError(detail), 501);
  });
  return app;
}

const SERVED = "GET /company, and customers and their addresses (list, get, create, update)";
