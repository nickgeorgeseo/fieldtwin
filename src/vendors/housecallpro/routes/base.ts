import type { Context } from "hono";
import { hcpError } from "../errors.ts";

/**
 * Where the twin serves Housecall Pro. The real API is at https://api.housecallpro.com, with paths like /customers and
 * /jobs straight after the host. Some real paths (/api/invoices/{uuid}) start the way Jobber's do, and two vendors
 * can't share a prefix, so the twin serves the same paths under /housecallpro: set your client's base URL to
 * http://localhost:4010/housecallpro and keep the rest of the path the same.
 */
export const HCP = "/housecallpro";

/**
 * 404 for a record that doesn't exist, in the words Lock Job documents for one ("job not found"). Lower case is the
 * docs' own; estimates.ts passes "Estimate" capitalised because its docs write "Estimate not found".
 */
export function notFound(c: Context, what: string) {
  return c.json(hcpError(`${what} not found`), 404);
}
