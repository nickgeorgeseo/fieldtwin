import type { Hono } from "hono";
import type { Twin } from "../../../core/twin.ts";
import { qboErrors } from "../errors.ts";
import { newCustomerRecord } from "../state.ts";
import { type QboCustomer, type QboState, WRITABLE_CUSTOMER_FIELDS } from "../types.ts";
import {
  asResponse,
  COMPANY,
  checkSyncToken,
  mergeUpdate,
  nextVersion,
  pickWritable,
  readEntityBody,
  type UpdateBody,
  writeKind,
} from "./entity.ts";
import { checkRequestId } from "./request-id.ts";

/** Customer: https://developer.intuit.com/app/developer/qbo/docs/api/accounting/all-entities/customer */
export function customerRoutes(app: Hono, twin: Twin): void {
  const state = () => twin.state<QboState>("quickbooks");
  const now = () => twin.clock.nowIso();

  app.get(`${COMPANY}/customer/:id`, (c) => {
    const customer = state().customers.get(c.req.param("id"));
    if (!customer) return c.json(qboErrors.notFound(now()), 400);
    return c.json({ Customer: asResponse(customer), time: now() });
  });

  // QuickBooks uses one POST endpoint for both create and update. An Id in the body means update.
  app.post(`${COMPANY}/customer`, async (c) => {
    const body = await readEntityBody<QboCustomer>(c, '{"DisplayName": "Ada Alder"}', now());
    if ("Fault" in body) return c.json(body, 400);
    const kind = writeKind(c.req.query("operation"), body, "Customer", now());
    if (typeof kind !== "string") return c.json(kind, 400);
    // Only now, with the whole body read, is the requestid checked: nothing can write between the check and the write.
    const checked = checkRequestId(c, state(), now());
    if ("answer" in checked) return checked.answer;
    const result = kind === "update" ? updateCustomer(twin, body, checked.requestId) : createCustomer(twin, body, checked.requestId);
    if ("Fault" in result) return c.json(result, 400);
    return c.json({ Customer: asResponse(result), time: now() });
  });
}

function createCustomer(twin: Twin, body: Partial<QboCustomer>, requestId: string | undefined) {
  const state = twin.state<QboState>("quickbooks");
  const now = twin.clock.nowIso();
  const fields = pickWritable(body, WRITABLE_CUSTOMER_FIELDS);

  // QuickBooks builds a DisplayName from the person's name when none is given.
  fields.DisplayName ??= [fields.GivenName, fields.FamilyName].filter(Boolean).join(" ") || undefined;
  if (!fields.DisplayName) return qboErrors.missingField("DisplayName", now);
  const taken = customerNamed(state, fields.DisplayName);
  if (taken) return qboErrors.duplicateName(taken.Id, now);

  const customer = newCustomerRecord(state, { ...fields, DisplayName: fields.DisplayName }, now);
  twin.record({ vendor: "quickbooks", type: "CustomerCreated", data: { customer, ...(requestId && { requestId }) } }, "api");
  return customer;
}

function updateCustomer(twin: Twin, body: UpdateBody<QboCustomer>, requestId: string | undefined) {
  const state = twin.state<QboState>("quickbooks");
  const now = twin.clock.nowIso();
  const existing = state.customers.get(String(body.Id));
  if (!existing) return qboErrors.notFound(now);

  const conflict = checkSyncToken(existing, body, now);
  if (conflict) return conflict;

  const fields = mergeUpdate(existing, body, WRITABLE_CUSTOMER_FIELDS);
  if (!fields.DisplayName) return qboErrors.missingField("DisplayName", now);
  const taken = customerNamed(state, fields.DisplayName);
  if (taken && taken.Id !== existing.Id) return qboErrors.duplicateName(taken.Id, now);

  const customer: QboCustomer = { Active: true, ...fields, DisplayName: fields.DisplayName, ...nextVersion(existing, now) };
  twin.record({ vendor: "quickbooks", type: "CustomerUpdated", data: { customer, ...(requestId && { requestId }) } }, "api");
  return customer;
}

function customerNamed(state: QboState, name: string): QboCustomer | undefined {
  return [...state.customers.values()].find((customer) => customer.DisplayName === name);
}
