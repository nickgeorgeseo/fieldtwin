/**
 * Fault rules as the twin takes them (PUT /_twin/faults; README "Scenarios and faults"), and ready-made ones to
 * start from. The twin only says which rules are active by name, so the dashboard writes the whole list each time.
 */

export interface FaultRule {
  name: string;
  vendor: string;
  method?: string;
  pathIncludes?: string;
  pathExcludes?: string;
  webhook?: string;
  rate: number;
  effect: Record<string, unknown>;
}

export const FAULT_PRESETS: { label: string; rule: FaultRule }[] = [
  {
    label: "QuickBooks throttles 1 in 5 writes (429)",
    rule: {
      name: "qbo-throttled-writes",
      vendor: "quickbooks",
      method: "POST",
      rate: 0.2,
      effect: { status: 429, message: "ThrottleExceeded" },
    },
  },
  {
    label: "QuickBooks loses 1 in 10 answers after writing (504)",
    rule: { name: "qbo-lost-answers", vendor: "quickbooks", method: "POST", rate: 0.1, effect: { status: 504, lostResponse: true } },
  },
  {
    label: "QuickBooks is down (503)",
    rule: { name: "qbo-unavailable", vendor: "quickbooks", rate: 1, effect: { status: 503 } },
  },
  {
    label: "Jobber answers slowly (800 ms)",
    rule: { name: "jobber-slow", vendor: "jobber", rate: 1, effect: { latencyMs: 800 } },
  },
  {
    label: "Jobber sends half its webhooks twice",
    rule: { name: "jobber-webhooks-twice", vendor: "jobber", webhook: "*", rate: 0.5, effect: { duplicate: true } },
  },
  {
    label: "Jobber sends 1 in 5 webhooks 5 minutes late",
    rule: { name: "jobber-webhooks-late", vendor: "jobber", webhook: "*", rate: 0.2, effect: { delayMs: 300_000 } },
  },
  {
    label: "Housecall Pro throttles 1 in 5 requests (429, with RateLimit-Reset)",
    rule: { name: "hcp-throttled", vendor: "housecallpro", rate: 0.2, effect: { status: 429 } },
  },
  {
    // Customers only: a lost answer from the token endpoint would cost a client its rotated refresh token for good.
    label: "Housecall Pro loses 1 in 10 answers after creating a customer (504)",
    rule: {
      name: "hcp-lost-customers",
      vendor: "housecallpro",
      method: "POST",
      pathIncludes: "/customers",
      rate: 0.1,
      effect: { status: 504, lostResponse: true },
    },
  },
];

/** The rules written so far (JSON text) with `rule` added, or put in place of the rule with its name. */
export function withRule(text: string, rule: FaultRule): string {
  const rules = parseList(text);
  const at = rules.findIndex((existing) => existing.name === rule.name);
  if (at === -1) rules.push(rule);
  else rules[at] = rule;
  return JSON.stringify(rules, null, 2);
}

function parseList(text: string): FaultRule[] {
  try {
    const value: unknown = JSON.parse(text);
    return Array.isArray(value) ? value : [];
  } catch {
    return [];
  }
}
