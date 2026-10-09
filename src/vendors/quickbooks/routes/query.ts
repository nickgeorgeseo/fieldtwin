import type { Context, Hono } from "hono";
import type { Twin } from "../../../core/twin.ts";
import { qboErrors } from "../errors.ts";
import { parseQboQuery, type QboQuery, type QueryValue } from "../query-language.ts";
import type { QboEntityName, QboState } from "../types.ts";
import { asResponse, COMPANY, ENTITY_RECORDS, entityNamed } from "./entity.ts";

const METADATA = ["MetaData.CreateTime", "MetaData.LastUpdatedTime"];

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

  let matching: object[] = [...ENTITY_RECORDS[entity](state).values()];
  if (query.where) {
    const { where } = query;
    const property = properties.find((name) => name.toLowerCase() === where.property.toLowerCase());
    if (!property) {
      return { invalid: `${where.property} is not a property the twin can filter ${entity} on. Try: ${properties.join(", ")}` };
    }
    matching = matching.filter((record) => where.values.some((value) => matches(valueAt(record, property), value)));
  }

  // "The number of entities is returned as the value of the totalCount field ... data objects ... aren't in the response."
  if (query.select === "count") return { response: { totalCount: matching.length } };

  const page = matching.slice(query.startPosition - 1, query.startPosition - 1 + query.maxResults);
  // QuickBooks answers an empty QueryResponse, with no entity key, when nothing matches.
  if (!page.length) return { response: {} };
  return { response: { [entity]: page.map(asResponse), startPosition: query.startPosition, maxResults: page.length } };
}

/** The comparable value of a property: references compare by Id (`value`), email addresses by `Address`. */
function valueAt(record: object, path: string): unknown {
  let value: unknown = record;
  for (const key of path.split(".")) value = (value as Record<string, unknown> | undefined)?.[key];
  if (value && typeof value === "object") {
    const leaf = value as { value?: unknown; Address?: unknown };
    return leaf.value ?? leaf.Address;
  }
  return value;
}

/** "Attribute values are also not case sensitive." Numbers and booleans compare by value. */
function matches(actual: unknown, wanted: QueryValue): boolean {
  if (actual === undefined || actual === null) return false;
  if (typeof actual === "number") return actual === Number(wanted);
  if (typeof actual === "boolean") return actual === (String(wanted).toLowerCase() === "true");
  return String(actual).toLowerCase() === String(wanted).toLowerCase();
}
