import type { MiddlewareHandler } from "hono";
import type { Twin } from "../core/twin.ts";
import { type FaultRule, faultHeaderValue } from "../core/types.ts";
import type { VendorTwin } from "../core/vendor-twin.ts";

/**
 * Wraps a vendor's routes and makes them misbehave according to twin.faultRules.
 *
 * Vendor code never knows this exists. The middleware asks the vendor for an error body
 * in its own format, and any headers it sends with one, so a 429 from the QuickBooks twin
 * looks like a QuickBooks 429 and one from Housecall Pro carries its RateLimit-Reset.
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
    // Every roll happens as the request arrives, before any wait, so which requests meet which faults depends only on
    // the order they arrive in, not on how long another request is held up (ARCHITECTURE.md rule 2).
    let latencyMs = 0;
    let error: FaultRule | undefined;
    for (const rule of twin.faultRules) {
      if (!matches(rule, vendor.name, c.req.method, c.req.path) || !twin.faultRandom.requests.chance(rule.rate)) continue;
      latencyMs += rule.effect.latencyMs ?? 0;
      if (rule.effect.status) {
        error = rule;
        break;
      }
    }
    if (latencyMs) await sleep(latencyMs);
    if (!error?.effect.status) return next();
    const { status, message = `Injected by fault rule "${error.name}"`, lostResponse } = error.effect;
    const answer = new Response(JSON.stringify(vendor.errorBody(status, message, twin)), {
      status,
      // X-Twin-Fault, so you can tell injected failures from real bugs
      headers: { ...vendor.errorHeaders?.(status, twin), "Content-Type": "application/json", "X-Twin-Fault": faultHeaderValue(error.name) },
    });
    if (!lostResponse) return answer;
    await next(); // the work happens, events and all
    c.res = undefined; // then the real answer is dropped (assigning undefined first stops Hono merging its headers in)
    c.res = answer;
  };
}

function matches(rule: FaultRule, vendor: string, method: string, path: string): boolean {
  return (
    rule.webhook === undefined && // webhook rules are for deliveries; see webhook-faults.ts
    rule.vendor === vendor &&
    (!rule.method || rule.method.toUpperCase() === method.toUpperCase()) &&
    (!rule.pathIncludes || path.includes(rule.pathIncludes)) &&
    (!rule.pathExcludes || !path.includes(rule.pathExcludes))
  );
}

/** Node cuts a timer over 2^31-1 ms to 1 ms, and week-long rules can add up past that, so a long wait goes in pieces. */
const LONGEST_TIMER_MS = 2 ** 31 - 1;

async function sleep(milliseconds: number): Promise<void> {
  for (let left = milliseconds; left > 0; left -= LONGEST_TIMER_MS) {
    await new Promise((resolve) => setTimeout(resolve, Math.min(left, LONGEST_TIMER_MS)));
  }
}
