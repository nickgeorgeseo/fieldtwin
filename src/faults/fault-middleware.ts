import type { MiddlewareHandler } from "hono";
import type { Twin } from "../core/twin.ts";
import type { FaultRule } from "../core/types.ts";
import type { VendorTwin } from "../core/vendor-twin.ts";

/**
 * Wraps a vendor's routes and makes them misbehave according to twin.faultRules.
 *
 * Vendor code never knows this exists. The middleware asks the vendor for an error body
 * in its own format, so a 429 from the QuickBooks twin looks like a QuickBooks 429.
 *
 * Rules layer: every rule that matches the request gets its own roll of the dice, in order.
 * Latencies add up, and the first error that fires answers the request.
 */
export function faultMiddleware(twin: Twin, vendor: VendorTwin): MiddlewareHandler {
  return async (c, next) => {
    for (const rule of twin.faultRules) {
      if (!matches(rule, vendor.name, c.req.method, c.req.path) || !twin.faultRandom.chance(rule.rate)) continue;
      if (rule.effect.latencyMs) await sleep(rule.effect.latencyMs);
      if (rule.effect.status) {
        const message = rule.effect.message ?? `Injected by fault rule "${rule.name}"`;
        c.header("X-Twin-Fault", rule.name); // so you can tell injected failures from real bugs
        return c.json(vendor.errorBody(rule.effect.status, message, twin), rule.effect.status);
      }
    }
    return next();
  };
}

function matches(rule: FaultRule, vendor: string, method: string, path: string): boolean {
  return (
    rule.vendor === vendor &&
    (!rule.method || rule.method.toUpperCase() === method.toUpperCase()) &&
    (!rule.pathIncludes || path.includes(rule.pathIncludes))
  );
}

function sleep(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
