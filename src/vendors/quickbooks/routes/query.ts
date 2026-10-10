import type { Context, Hono } from "hono";
import type { Twin } from "../../../core/twin.ts";
import { qboDate, qboDateTimeMs } from "../dates.ts";
import { qboErrors } from "../errors.ts";
import { parseQboQuery, type QboQuery, type QueryCondition, type QueryOperator, type QueryValue } from "../query-language.ts";
import type { QboEntityName, QboState } from "../types.ts";
import { asResponse, COMPANY, ENTITY_RECORDS, entityNamed } from "./entity.ts";

const METADATA = ["MetaData.CreateTime", "MetaData.LastUpdatedTime"]; // compared as instants
const DATES = ["TxnDate", "DueDate"]; // compared as YYYY-MM-DD

/**
 * The query endpoint: https://developer.intuit.com/app/developer/qbo/docs/learn/explore-the-quickbooks-online-api/data-queries
 * Each entity lists the properties a WHERE clause may filter on (the ones the twin models that
 * the entity reference marks "filterable"). Property names match without regard to case, like QuickBooks.
 */
const FILTERABLE: Record<QboEntityName, string[]> = {
  Customer: ["Id", "DisplayName", "GivenName", "FamilyName", "PrimaryEmailAddr", "Active", ...METADATA],
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
  if (sortKeys.length) matching.sort(bySortKeys(sortKeys));

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

/** A value as it compares: MetaData times as instants, transaction dates as YYYY-MM-DD. undefined if unreadable. */
function comparable(property: string, value: unknown): unknown {
  if (value === undefined || value === null) return undefined;
  if (METADATA.includes(property)) return qboDateTimeMs(String(value));
  if (DATES.includes(property)) return qboDate(value);
  return value;
}

function unreadableValue(property: string, value: QueryValue): string {
  return METADATA.includes(property)
    ? `'${value}' isn't a date-time the twin can read for ${property}. Use a form like '2026-07-13T11:00:00-05:00'`
    : `'${value}' isn't a date the twin can read for ${property}. Use a form like '2026-07-13'`;
}

const ORDER_TESTS: Record<Exclude<QueryOperator, "like">, (order: number) => boolean> = {
  "=": (order) => order === 0,
  in: (order) => order === 0,
  "<": (order) => order < 0,
  ">": (order) => order > 0,
  "<=": (order) => order <= 0,
  ">=": (order) => order >= 0,
};

function holds({ operator, values }: QueryCondition, actual: unknown): boolean {
  if (actual === undefined) return false;
  if (operator === "like") return likePattern(String(values[0])).test(String(actual));
  return values.some((wanted) => {
    const order = compareValues(actual, wanted);
    return order !== undefined && ORDER_TESTS[operator](order);
  });
}

/** "Wildcard character support for LIKE clauses is limited to '%'": every other character matches itself. */
function likePattern(pattern: string): RegExp {
  const literal = pattern.split("%").map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  return new RegExp(`^${literal.join(".*")}$`, "is");
}

/** Records without a property sort before those with it; ties keep the default order. */
function bySortKeys(keys: QboQuery["orderBy"]) {
  return (a: object, b: object): number => {
    for (const { property, descending } of keys) {
      const x = comparable(property, valueAt(a, property));
      const y = comparable(property, valueAt(b, property));
      const order = x === undefined ? (y === undefined ? 0 : -1) : y === undefined ? 1 : (compareValues(x, y) ?? 0);
      if (order !== 0) return descending ? -order : order;
    }
    return 0;
  };
}

/**
 * How two values of a property order: numbers by value (queries quote them too: TotalAmt > '1000.0'), and text
 * without regard to case ("Attribute values are also not case sensitive"), comparing digits-only text such as
 * Ids as numbers. Booleans put false first. undefined when a number meets something that isn't one.
 */
function compareValues(a: unknown, b: unknown): number | undefined {
  const x = asNumber(a);
  const y = asNumber(b);
  if (x !== undefined && y !== undefined) return Math.sign(x - y);
  if (typeof a === "number" || typeof b === "number") return undefined;
  if (typeof a === "boolean" || typeof b === "boolean") return asBoolean(a) - asBoolean(b);
  const [s, t] = [String(a).toLowerCase(), String(b).toLowerCase()];
  return s < t ? -1 : s > t ? 1 : 0;
}

const asNumber = (value: unknown) =>
  typeof value === "number" ? value : typeof value === "string" && /^-?\d+(\.\d+)?$/.test(value) ? Number(value) : undefined;
const asBoolean = (value: unknown) => (String(value).toLowerCase() === "true" ? 1 : 0);
