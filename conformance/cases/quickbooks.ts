import { type ConformanceCase, faultOf, quickbooks, quickbooksQuery } from "../case.ts";

/**
 * QuickBooks Online cases, one per FIDELITY.md row the twin can't confirm from the docs alone. These only read;
 * the ones that create records are in quickbooks-writes.ts, and run after these.
 * Not here: the 429 body. Provoking a real throttle means flooding the sandbox, so record one if you meet it.
 */

const DAY = 86_400_000;

export const quickbooksCases: ConformanceCase[] = [
  // CDC first, before any case writes, so "nothing changed since now" holds.
  {
    name: "cdc-nothing-changed",
    vendor: "quickbooks",
    endpoint: "GET /cdc",
    fidelity: "CDC group with no changes",
    async observe(target) {
      const answer = await quickbooks(target, "GET", `cdc?entities=Customer&changedSince=${encodeURIComponent(await target.now())}`);
      const group = answer.body?.CDCResponse?.[0]?.QueryResponse?.[0];
      return { status: answer.status, groupKeys: group ? Object.keys(group).sort() : null };
    },
  },
  {
    name: "cdc-look-back-over-30-days",
    vendor: "quickbooks",
    endpoint: "GET /cdc",
    fidelity: "CDC look-back over 30 days",
    async observe(target) {
      const since = new Date(Date.parse(await target.now()) - 31 * DAY).toISOString();
      return faultOf(await quickbooks(target, "GET", `cdc?entities=Customer&changedSince=${encodeURIComponent(since)}`));
    },
  },
  {
    name: "read-missing-entity",
    vendor: "quickbooks",
    endpoint: "GET /customer/{id}",
    fidelity: "HTTP status of 610 on a read",
    observe: async (target) => faultOf(await quickbooks(target, "GET", "customer/987654321")),
  },
  {
    name: "unknown-access-token",
    vendor: "quickbooks",
    endpoint: "GET /query",
    fidelity: "Expired or unknown token on the API",
    observe: async (target) =>
      faultOf(
        await quickbooks(target, "GET", "query?query=SELECT%20COUNT(*)%20FROM%20Customer", undefined, { token: "fieldtwin-not-a-token" }),
      ),
  },
  {
    name: "another-company",
    vendor: "quickbooks",
    endpoint: "GET /query",
    fidelity: "Wrong realm: 403 AuthorizationFault 3100",
    observe: async (target) =>
      faultOf(await quickbooks(target, "GET", "query?query=SELECT%20COUNT(*)%20FROM%20Customer", undefined, { realmId: "1" })),
  },
  {
    name: "entity-name-case",
    vendor: "quickbooks",
    endpoint: "GET /query",
    fidelity: "Query case and escaping",
    async observe(target) {
      const answer = await quickbooksQuery(target, "select count(*) from customer");
      return { status: answer.status, totalCountIsNumber: typeof answer.body?.QueryResponse?.totalCount === "number" };
    },
  },
  {
    name: "body-not-json",
    vendor: "quickbooks",
    endpoint: "POST /customer",
    fidelity: "A body that isn't a JSON object, or lines that aren't objects",
    async observe(target) {
      const { apiBase, realmId, accessToken } = target.quickbooks;
      const response = await target.fetch(`${apiBase}/company/${realmId}/customer`, {
        method: "POST",
        headers: { Authorization: `Bearer ${accessToken}`, Accept: "application/json", "Content-Type": "application/json" },
        body: "{not json",
      });
      return faultOf({ status: response.status, body: await response.json().catch(() => null) });
    },
  },
  {
    name: "range-operator-on-id",
    vendor: "quickbooks",
    endpoint: "GET /query",
    fidelity: "Range operators and LIKE on Id",
    observe: async (target) => faultOf(await quickbooksQuery(target, "select count(*) from Customer where Id > '0'")),
  },
  {
    name: "negative-number-unquoted",
    vendor: "quickbooks",
    endpoint: "GET /query",
    fidelity: "Unquoted negative numbers in queries",
    observe: async (target) => faultOf(await quickbooksQuery(target, "select count(*) from Invoice where TotalAmt > -1")),
  },
];
