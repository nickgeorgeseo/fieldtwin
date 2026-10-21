import type { Hono } from "hono";
import type { Twin } from "../../../core/twin.ts";
import type { HcpState } from "../types/index.ts";
import { HCP } from "./base.ts";

/**
 * Get Company: https://docs.housecallpro.com/docs/housecall-public-api/24a5d891a80a8-get-company
 * "You will receive all of your locations information in the locations object", a multi-location account's guide
 * says (https://docs.housecallpro.com/docs/housecall-public-api/4c64fe617d191-multi-location-enabled-ap-is). The
 * twin's company has no locations beneath it, so the list is empty.
 */
export function companyRoutes(app: Hono, twin: Twin): void {
  app.get(`${HCP}/company`, (c) => {
    return c.json({ ...twin.state<HcpState>("housecallpro").company, default_arrival_window: null, locations: [] });
  });
}
