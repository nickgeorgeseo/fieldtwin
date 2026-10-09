import type { Hono } from "hono";
import type { Twin } from "../../../core/twin.ts";
import { qboErrors } from "../errors.ts";
import { parseQboQuery } from "../query.ts";
import type { QboCustomer, QboState } from "../types.ts";
import { asResponse, COMPANY } from "./entity.ts";

/** The query endpoint: https://developer.intuit.com/app/developer/qbo/docs/learn/explore-the-quickbooks-online-api/data-queries */
export function queryRoutes(app: Hono, twin: Twin): void {
  const state = () => twin.state<QboState>("quickbooks");
  const now = () => twin.clock.nowIso();

  app.get(`${COMPANY}/query`, (c) => {
    const query = parseQboQuery(c.req.query("query") ?? "");
    if ("error" in query) return c.json(qboErrors.badQuery(query.error, now()), 400);
    if (query.entity.toLowerCase() !== "customer") {
      return c.json(qboErrors.invalidQuery(`The twin does not support querying ${query.entity}. Supported: Customer`, now()), 400);
    }

    let customers = [...state().customers.values()];
    if (query.where) {
      const { field, value } = query.where;
      customers = customers.filter((customer) => String(customer[field as keyof QboCustomer] ?? "") === value);
    }
    const page = customers.slice(query.startPosition - 1, query.startPosition - 1 + query.maxResults);

    return c.json({
      QueryResponse: page.length ? { Customer: page.map(asResponse), startPosition: query.startPosition, maxResults: page.length } : {},
      time: now(),
    });
  });
}
