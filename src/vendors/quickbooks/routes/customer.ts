import type { Hono } from "hono";
import type { Twin } from "../../../core/twin.ts";
import { type QboFault, qboErrors } from "../errors.ts";
import { newCustomerRecord } from "../state.ts";
import { type QboCustomer, type QboState, WRITABLE_CUSTOMER_FIELDS } from "../types.ts";
import { readTextFields } from "../values.ts";
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
  const badName = checkNames(fields, now);
  if (badName) return badName;

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
  const badName = checkNames(fields, now);
  if (badName) return badName;
  if (!fields.DisplayName) return qboErrors.missingField("DisplayName", now);
  const taken = customerNamed(state, fields.DisplayName);
  if (taken && taken.Id !== existing.Id) return qboErrors.duplicateName(taken.Id, now);

  const customer: QboCustomer = { Active: true, ...fields, DisplayName: fields.DisplayName, ...nextVersion(existing, now) };
  twin.record({ vendor: "quickbooks", type: "CustomerUpdated", data: { customer, ...(requestId && { requestId }) } }, "api");
  return customer;
}

const PERSON_NAME_FIELDS = ["DisplayName", "GivenName", "FamilyName"] as const;
const COMPANY_NAME_MAX_LENGTH = 100; // "max character: maximum of 100 chars"

/** The Customer reference's rules for names, or the Fault for the first one broken. */
function checkNames(fields: Partial<QboCustomer>, now: string): QboFault | undefined {
  const notText = readTextFields(fields, [...PERSON_NAME_FIELDS, "CompanyName"], now);
  if (notText) return notText;
  // "The DisplayName, Title, GivenName, MiddleName, FamilyName, Suffix, and PrintOnCheckName attributes must not contain
  // colon (:), tab (\t), or newline (\n) characters."
  for (const name of PERSON_NAME_FIELDS) {
    const value = fields[name];
    if (value && /[:\t\n]/.test(value)) return qboErrors.invalidString(name, value, now);
  }
  const { CompanyName } = fields;
  if (CompanyName && CompanyName.length > COMPANY_NAME_MAX_LENGTH) {
    return qboErrors.stringTooLong("CompanyName", COMPANY_NAME_MAX_LENGTH, CompanyName.length, now);
  }
  return undefined;
}

/**
 * The customer with this DisplayName, which "must be unique". The docs don't say whether "Ada Alder" and "ADA ALDER "
 * count as the same name; the twin says they do, so code that relies on telling them apart finds out here.
 */
function customerNamed(state: QboState, name: string): QboCustomer | undefined {
  const key = (displayName: string) => displayName.trim().toLowerCase();
  return [...state.customers.values()].find((customer) => key(customer.DisplayName) === key(name));
}
