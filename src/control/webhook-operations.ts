import type { Twin } from "../core/twin.ts";
import type { FaultRule } from "../core/types.ts";
import { parseWebhookSubscriptions } from "./scenario.ts";

/**
 * The webhook side of the control plane (operations.ts has the rest): an app's subscriptions, how each delivery went,
 * and the check that every topic a subscription or a fault rule names is one its vendor sends, since a misspelled
 * topic would otherwise never fire.
 */

/**
 * Replace the webhook subscriptions: the URLs and topics an app would set up in each vendor's developer settings.
 * Like OAuth connections, they belong to the app, so they survive reset and rewind.
 */
export function setWebhooks(twin: Twin, value: unknown) {
  const subscriptions = parseWebhookSubscriptions(value);
  for (const { vendor, topics } of subscriptions) checkTopics(twin, vendor, topics, "");
  twin.webhooks.subscriptions = subscriptions;
  return describeWebhooks(twin);
}

/** The subscriptions (without their secrets) and the latest deliveries, with how each one went. */
export function describeWebhooks(twin: Twin) {
  return {
    subscriptions: twin.webhooks.subscriptions.map(({ clientSecret: _secret, ...subscription }) => subscription),
    deliveries: twin.webhooks.deliveries(),
  };
}

/** Fault rules whose webhook topics the vendor really sends; a misspelled topic would otherwise never fire. */
export function checkWebhookTopics(twin: Twin, rules: FaultRule[]): FaultRule[] {
  for (const { name, vendor, webhook } of rules) {
    if (webhook !== undefined && webhook !== "*") checkTopics(twin, vendor, [webhook], `Fault rule "${name}": `); // "*": any topic
  }
  return rules;
}

/** Throws, naming the topics the vendor does send, unless it sends every one of `topics`. */
function checkTopics(twin: Twin, vendor: string, topics: readonly string[], context: string): void {
  const sent = twin.vendor(vendor).webhooks?.topics ?? [];
  const unknown = topics.filter((topic) => !sent.includes(topic));
  if (unknown.length) {
    throw new Error(`${context}${vendor} never sends ${unknown.join(", ")}. Topics the twin sends: ${sent.join(", ") || "none yet"}`);
  }
}
