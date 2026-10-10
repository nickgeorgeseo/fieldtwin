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
 *
 * Most errors answer before the twin does anything, like a throttle or an outage. A `lostResponse` rule lets the
 * twin do the work first and answers with the error anyway, the way a gateway timeout or a dropped connection
 * hides a write that succeeded. That is the failure a retried write has to survive without happening twice.
 */
export function faultMiddleware(twin: Twin, vendor: VendorTwin): MiddlewareHandler {
  return async (c, next) => {
    for (const rule of twin.faultRules) {
      if (!matches(rule, vendor.name, c.req.method, c.req.path) || !twin.faultRandom.requests.chance(rule.rate)) continue;
      if (rule.effect.latencyMs) await sleep(rule.effect.latencyMs);
      if (rule.effect.status) {
        const message = rule.effect.message ?? `Injected by fault rule "${rule.name}"`;
        const answer = new Response(JSON.stringify(vendor.errorBody(rule.effect.status, message, twin)), {
          status: rule.effect.status,
          // X-Twin-Fault, so you can tell injected failures from real bugs
          headers: { "Content-Type": "application/json", "X-Twin-Fault": rule.name },
        });
        if (!rule.effect.lostResponse) return answer;
        await next(); // the work happens, events and all
        c.res = undefined; // then the real answer is dropped (assigning undefined first stops Hono merging its headers in)
        c.res = answer;
        return;
      }
    }
    return next();
  };
}

function matches(rule: FaultRule, vendor: string, method: string, path: string): boolean {
  return (
    rule.webhook === undefined && // webhook rules are for deliveries; see webhook-faults.ts
    rule.vendor === vendor &&
    (!rule.method || rule.method.toUpperCase() === method.toUpperCase()) &&
    (!rule.pathIncludes || path.includes(rule.pathIncludes))
  );
}

function sleep(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
