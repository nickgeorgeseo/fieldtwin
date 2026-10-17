import type { Hono } from "hono";
import type { Twin } from "../../../core/twin.ts";
import type { HcpState } from "../types.ts";
import { HCP } from "./base.ts";

/** Get Company: https://docs.housecallpro.com/docs/housecall-public-api/24a5d891a80a8-get-company */
export function companyRoutes(app: Hono, twin: Twin): void {
  app.get(`${HCP}/company`, (c) => {
    const { utcOffsetHours: _, ...company } = twin.state<HcpState>("housecallpro").company;
    return c.json(company);
  });
}
