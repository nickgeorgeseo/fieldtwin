import type { MiddlewareHandler } from "hono";
import type { Twin } from "../../../core/twin.ts";
import { hcpError } from "../errors.ts";
import type { HcpState } from "../types/index.ts";
import { listParam } from "./filters.ts";

/**
 * Multi-location accounts say which location a request is for with an `X-Company-Id` header or, the older way, a
 * `location_ids` list, which is "ignored" when the header is sent too. "API keys cannot access data for unrelated or
 * higher-level locations", and a request for one the caller can't reach returns "403 Forbidden".
 * https://docs.housecallpro.com/docs/housecall-public-api/4c64fe617d191-multi-location-enabled-ap-is
 *
 * The twin's company has no locations beneath it, so it is the only one a request can name.
 */
export function locationCheck(twin: Twin): MiddlewareHandler {
  return async (c, next) => {
    const header = c.req.header("X-Company-Id");
    const asked = header !== undefined ? [header] : listParam(c.req, "location_ids");
    const { id } = twin.state<HcpState>("housecallpro").company;
    const unreachable = asked.find((location) => location !== id);
    if (unreachable === undefined) return next();
    const message = `Location ${unreachable} isn't one this key can reach. The twin's company, ${id}, has no other locations.`;
    return c.json(hcpError(message), 403);
  };
}
