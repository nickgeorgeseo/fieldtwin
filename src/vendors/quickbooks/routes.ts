import { Hono } from "hono";
import type { Twin } from "../../core/twin.ts";
import { qboErrors } from "./errors.ts";
import { parseQboQuery } from "./query.ts";
import { newCustomerRecord } from "./state.ts";
import { type QboCustomer, type QboState, WRITABLE_CUSTOMER_FIELDS } from "./types.ts";

/**
 * QuickBooks Online Accounting API, v3 (Customer only, for now).
 * Real base URL: https://quickbooks.api.intuit.com/v3/company/{realmId}/...
 * Point your client at http://localhost:4010 instead and keep the rest of the path the same.
 */
export function quickbooksRoutes(twin: Twin): Hono {
  const app = new Hono();
  const state = () => twin.state<QboState>("quickbooks");
  const now = () => twin.clock.nowIso();

  // Every request needs a bearer token (the twin accepts any token until the OAuth twin lands),
  // and every QuickBooks URL names a company ("realm"). The twin serves exactly one.
  app.use("/v3/company/:realmId/*", async (c, next) => {
    if (!c.req.header("Authorization")?.startsWith("Bearer ")) {
      return c.json(qboErrors.notAuthenticated(now()), 401);
    }
    if (c.req.param("realmId") !== state().realmId) {
      return c.json(qboErrors.wrongRealm(state().realmId, now()), 403);
    }
    await next();
  });

  app.get("/v3/company/:realmId/customer/:id", (c) => {
    const customer = state().customers.get(c.req.param("id"));
    if (!customer) return c.json(qboErrors.notFound("Customer", c.req.param("id"), now()), 400);
    return c.json({ Customer: customer, time: now() });
  });

  // QuickBooks uses one POST endpoint for both create and update. An Id in the body means update.
  app.post("/v3/company/:realmId/customer", async (c) => {
    const body = (await c.req.json()) as Partial<QboCustomer> & { sparse?: boolean };
    const result = body.Id ? updateCustomer(twin, body) : createCustomer(twin, body);
    if ("Fault" in result) return c.json(result, 400);
    return c.json({ Customer: result, time: now() });
  });

  app.get("/v3/company/:realmId/query", (c) => {
    const query = parseQboQuery(c.req.query("query") ?? "");
    if ("error" in query) return c.json(qboErrors.badQuery(query.error, now()), 400);
    if (query.entity.toLowerCase() !== "customer") {
      return c.json(qboErrors.badQuery(`The twin does not support querying ${query.entity} yet`, now()), 400);
    }

    let customers = [...state().customers.values()];
    if (query.where) {
      const { field, value } = query.where;
      customers = customers.filter((customer) => String(customer[field as keyof QboCustomer] ?? "") === value);
    }
    const page = customers.slice(query.startPosition - 1, query.startPosition - 1 + query.maxResults);

    return c.json({
      QueryResponse: page.length ? { Customer: page, startPosition: query.startPosition, maxResults: page.length } : {},
      time: now(),
    });
  });

  return app;
}

function createCustomer(twin: Twin, body: Partial<QboCustomer>) {
  const state = twin.state<QboState>("quickbooks");
  const now = twin.clock.nowIso();
  const fields = pickWritable(body);

  // QuickBooks builds a DisplayName from the person's name when none is given.
  fields.DisplayName ??= [fields.GivenName, fields.FamilyName].filter(Boolean).join(" ") || undefined;
  if (!fields.DisplayName) return qboErrors.missingField("DisplayName", now);
  if (isDisplayNameTaken(state, fields.DisplayName)) return qboErrors.duplicateName(fields.DisplayName, now);

  const customer = newCustomerRecord(state, { ...fields, DisplayName: fields.DisplayName }, now);
  twin.record({ vendor: "quickbooks", type: "CustomerCreated", data: { customer } }, "api");
  return customer;
}

function updateCustomer(twin: Twin, body: Partial<QboCustomer> & { sparse?: boolean }) {
  const state = twin.state<QboState>("quickbooks");
  const now = twin.clock.nowIso();
  const existing = state.customers.get(body.Id!);

  if (!existing) return qboErrors.notFound("Customer", body.Id!, now);
  if (body.SyncToken === undefined) return qboErrors.missingField("SyncToken", now);

  // The quirk that breaks real integrations: you must send the SyncToken you last read.
  // If anyone changed the record since then, QuickBooks rejects your update.
  if (body.SyncToken !== existing.SyncToken) return qboErrors.staleObject(existing.Id, now);

  // A sparse update changes only the fields you send. A full update replaces every writable field,
  // so anything you leave out is cleared. Getting this wrong silently wipes data in production.
  const base = body.sparse ? pickWritable(existing) : {};
  const fields = { ...base, ...pickWritable(body) };
  if (!fields.DisplayName) return qboErrors.missingField("DisplayName", now);
  if (fields.DisplayName !== existing.DisplayName && isDisplayNameTaken(state, fields.DisplayName)) {
    return qboErrors.duplicateName(fields.DisplayName, now);
  }

  const customer: QboCustomer = {
    Active: true,
    ...fields,
    DisplayName: fields.DisplayName,
    Id: existing.Id,
    SyncToken: String(Number(existing.SyncToken) + 1),
    MetaData: { CreateTime: existing.MetaData.CreateTime, LastUpdatedTime: now },
  };
  twin.record({ vendor: "quickbooks", type: "CustomerUpdated", data: { customer } }, "api");
  return customer;
}

function pickWritable(source: Partial<QboCustomer>): Partial<QboCustomer> {
  const picked: Partial<QboCustomer> = {};
  for (const field of WRITABLE_CUSTOMER_FIELDS) {
    if (source[field] !== undefined) (picked as Record<string, unknown>)[field] = source[field];
  }
  return picked;
}

function isDisplayNameTaken(state: QboState, name: string): boolean {
  return [...state.customers.values()].some((customer) => customer.DisplayName === name);
}
