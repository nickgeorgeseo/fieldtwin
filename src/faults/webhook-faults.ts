import type { Twin } from "../core/twin.ts";
import type { DeliveryFaults } from "../core/webhooks.ts";

/**
 * Makes webhook deliveries misbehave the way at-least-once delivery does on a bad day, from fault rules that name
 * a topic (or "*") under `webhook`:
 *
 *   effect: { duplicate: true }    the delivery is sent twice ("the same webhook may be delivered more than once")
 *   effect: { delayMs: 600000 }    it goes out that much twin time late, so deliveries after it overtake it
 *
 * Each matching rule gets its own roll of the dice, from a stream request faults don't share, so subscribing an app
 * never changes which requests fail. A faulted delivery carries an X-Twin-Fault header naming the rule, so an app's
 * logs can tell injected trouble from real trouble.
 */
export function webhookFaults(twin: Twin): DeliveryFaults {
  return ({ vendor, topic }) => {
    const decision: ReturnType<DeliveryFaults> = { delayMs: 0 };
    for (const rule of twin.faultRules) {
      if (rule.webhook === undefined || rule.vendor !== vendor || (rule.webhook !== "*" && rule.webhook !== topic)) continue;
      if (!twin.faultRandom.webhooks.chance(rule.rate)) continue;
      if (rule.effect.duplicate) decision.duplicatedBy ??= rule.name;
      if (rule.effect.delayMs) {
        decision.delayMs += rule.effect.delayMs;
        decision.delayedBy ??= rule.name;
      }
    }
    return decision;
  };
}
