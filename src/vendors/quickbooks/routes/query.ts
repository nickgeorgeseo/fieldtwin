import type { Context, Hono } from "hono";
import type { Twin } from "../../../core/twin.ts";
import { qboErrors } from "../errors.ts";
import { parseQboQuery, type QboQuery, type QueryCondition, type QueryValue } from "../query-language.ts";
import { bySortKeys, comparable, holds, METADATA, unreadableValue } from "../query-values.ts";
import type { QboEntityName, QboState } from "../types.ts";
import { asResponse, COMPANY, ENTITY_RECORDS, entityNamed } from "./entity.ts";

/**
 * The query endpoint: https://developer.intuit.com/app/developer/qbo/docs/learn/explore-the-quickbooks-online-api/data-queries
 * Each entity lists the properties a WHERE clause may filter on (the ones the twin models that
 * the entity reference marks "filterable"). Property names match without regard to case, like QuickBooks.
 */
const FILTERABLE: Record<QboEntityName, string[]> = {
  Customer: ["Id", "DisplayName", "GivenName", "FamilyName", "CompanyName", "PrimaryEmailAddr", "Active", ...METADATA],
  Item: ["Id", "Name", "FullyQualifiedName", "Type", "Active", ...METADATA],
  Invoice: ["Id", "DocNumber", "TxnDate", "DueDate", "CustomerRef", "TotalAmt", "Balance", ...METADATA],
  Payment: ["Id", "TxnDate", "CustomerRef", "TotalAmt", "PaymentRefNum", ...METADATA],
};

export function queryRoutes(app: Hono, twin: Twin): void {
  const now = () => twin.clock.nowIso();

  const answer = (statement: string) => {
    const query = parseQboQuery(statement);
    if ("error" in query) {
      return query.kind === "syntax" ? qboErrors.badQuery(query.error, now()) : qboErrors.unsupportedOperation(query.error, now());
    }
    const result = runQuery(twin.state<QboState>("quickbooks"), query);
    if ("invalid" in result) return qboErrors.invalidQuery(result.invalid, now());
    return { QueryResponse: result.response, time: now() };
  };
  const respond = (c: Context, body: ReturnType<typeof answer>) => ("Fault" in body ? c.json(body, 400) : c.json(body));

  app.get(`${COMPANY}/query`, (c) => respond(c, answer(c.req.query("query") ?? "")));
  // "Use a POST operation ... sending the query details in the request body", content type application/text.
  app.post(`${COMPANY}/query`, async (c) => respond(c, answer(await c.req.text())));
}

function runQuery(state: QboState, query: QboQuery): { response: object } | { invalid: string } {
  const entity = entityNamed(query.entity);
  if (!entity) return { invalid: `The twin can't query ${query.entity}. Queryable entities: ${Object.keys(FILTERABLE).join(", ")}` };
  const properties = FILTERABLE[entity];
  const named = (name: string) => properties.find((property) => property.toLowerCase() === name.toLowerCase());

  const conditions: QueryCondition[] = [];
  for (const condition of query.where) {
    const property = named(condition.property);
    if (!property)
      return { invalid: `${condition.property} is not a property the twin can filter ${entity} on. Try: ${properties.join(", ")}` };
    // "Filtering on the ID field does not support operators >, <, >=, <=, !=, and LIKE. Only = and IN are supported."
    if (property === "Id" && condition.operator !== "=" && condition.operator !== "in") {
      return { invalid: `QuickBooks filters Id with = and IN only, not ${condition.operator.toUpperCase()}` };
    }
    const values = condition.values.map((value) => comparable(property, value));
    const unreadable = condition.values.find((_, i) => values[i] === undefined);
    if (unreadable !== undefined) return { invalid: unreadableValue(property, unreadable) };
    conditions.push({ property, operator: condition.operator, values: values as QueryValue[] });
  }

  // "To get all active and inactive customers ... filter using the Active attribute": without one, only active records.
  if (properties.includes("Active") && !conditions.some((condition) => condition.property === "Active")) {
    conditions.push({ property: "Active", operator: "=", values: [true] });
  }

  const sortKeys: QboQuery["orderBy"] = [];
  for (const key of query.orderBy) {
    const property = named(key.property);
    if (!property) return { invalid: `${key.property} is not a property the twin can sort ${entity} by. Try: ${properties.join(", ")}` };
    sortKeys.push({ property, descending: key.descending });
  }

  const matching = [...ENTITY_RECORDS[entity](state).values()].filter((record: object) =>
    conditions.every((condition) => holds(condition, comparable(condition.property, valueAt(record, condition.property)))),
  );
  if (sortKeys.length) matching.sort(bySortKeys(sortKeys, valueAt));

  // "The number of entities is returned as the value of the totalCount field ... data objects ... aren't in the response."
  if (query.select === "count") return { response: { totalCount: matching.length } };

  const page = matching.slice(query.startPosition - 1, query.startPosition - 1 + query.maxResults);
  // QuickBooks answers an empty QueryResponse, with no entity key, when nothing matches.
  if (!page.length) return { response: {} };
  return { response: { [entity]: page.map(asResponse), startPosition: query.startPosition, maxResults: page.length } };
}

/** The value of a property: references compare by Id (`value`), email addresses by `Address`. */
function valueAt(record: object, path: string): unknown {
  let value: unknown = record;
  for (const key of path.split(".")) value = (value as Record<string, unknown> | undefined)?.[key];
  if (value && typeof value === "object") {
    const leaf = value as { value?: unknown; Address?: unknown };
    return leaf.value ?? leaf.Address;
  }
  return value;
}
