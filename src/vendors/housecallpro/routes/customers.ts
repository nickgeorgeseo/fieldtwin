import type { Hono } from "hono";
import { readJsonObject } from "../../../core/request-body.ts";
import type { Twin } from "../../../core/twin.ts";
import { hcpTime } from "../dates.ts";
import { hcpError } from "../errors.ts";
import { hcpId } from "../ids.ts";
import { ADDRESS_TEXT_FIELDS, type HcpCompany, type HcpCustomer, type HcpState } from "../types/index.ts";
import { HCP, notFound } from "./base.ts";
import { identityProblem, noCustomerText, readAddressList, readCustomerFields } from "./customer-body.ts";
import { NOTHING_EXPANDED, pageOf, readExpand, readList, sorted } from "./lists.ts";

/**
 * Customers. Get Customers:   https://docs.housecallpro.com/docs/housecall-public-api/042bd3bf861ae-get-customers
 *            Create Customer: https://docs.housecallpro.com/docs/housecall-public-api/4e0bf8c4d65d7-create-customer
 *            Get Customer:    https://docs.housecallpro.com/docs/housecall-public-api/7599b1ec89338-get-customer
 *            Update Customer: https://docs.housecallpro.com/docs/housecall-public-api/b1c3acd657849-update-customer
 */
export function customerRoutes(app: Hono, twin: Twin): void {
  const state = () => twin.state<HcpState>("housecallpro");
  const now = () => hcpTime(twin.clock.nowIso());

  app.get(`${HCP}/customers`, (c) => {
    const list = readList(c.req, { sortable: SORTABLE, sortBy: "created_at", expandable: EXPANDABLE });
    if ("problem" in list) return c.json(hcpError(list.problem), 400);
    const found = [...state().customers.values()].filter((customer) => matchesSearch(customer, c.req.query("q") ?? ""));
    const records = sorted(found, list.sort, (customer, by) => customer[by]);
    return c.json(pageOf("customers", records, list.paging, (customer) => customerResponse(customer, state().company, list.expand)));
  });

  app.get(`${HCP}/customers/:id`, (c) => {
    const customer = state().customers.get(c.req.param("id"));
    if (!customer) return notFound(c, "customer");
    const expand = readExpand(c.req, EXPANDABLE);
    if ("problem" in expand) return c.json(hcpError(expand.problem), 400);
    return c.json(customerResponse(customer, state().company, expand));
  });

  app.post(`${HCP}/customers`, async (c) => {
    const read = await readJsonObject(c, '{"first_name": "Ada", "last_name": "Alder"}');
    if ("problem" in read) return c.json(hcpError(read.problem), 400);
    const fields = readCustomerFields(read.body);
    const addresses = readAddressList(read.body.addresses);
    if ("problem" in fields) return c.json(hcpError(fields.problem), fields.status);
    if ("problem" in addresses) return c.json(hcpError(addresses.problem), addresses.status);
    const missing = identityProblem(fields);
    if (missing) return c.json(hcpError(missing), 422);

    const { counts, company } = state();
    const customer: HcpCustomer = {
      id: hcpId("cus", counts.customers + 1),
      ...noCustomerText(),
      notifications_enabled: false, // not documented; off, so the twin never assumes a customer agreed to messages
      tags: [],
      ...fields,
      addresses: addresses.map((address, index) => ({ id: hcpId("adr", counts.addresses + 1 + index), type: "service", ...address })),
      created_at: now(),
      updated_at: now(),
    };
    twin.record({ vendor: "housecallpro", type: "CustomerCreated", data: { customer } }, "api");
    return c.json(customerResponse(customer, company, NOTHING_EXPANDED), 201);
  });

  // A PUT changes the fields it sends and leaves the rest, the way Rails updates attributes; null clears a field. A PUT
  // that changes nothing records nothing, as Rails touches neither the row nor updated_at then (FIDELITY.md).
  app.put(`${HCP}/customers/:id`, async (c) => {
    const read = await readJsonObject(c, '{"last_name": "Alder"}');
    if ("problem" in read) return c.json(hcpError(read.problem), 400);
    // Only now, with the whole body read, is the customer looked up: nothing can change it between the read and the write.
    const existing = state().customers.get(c.req.param("id"));
    if (!existing) return notFound(c, "customer");
    const fields = readCustomerFields(read.body);
    if ("problem" in fields) return c.json(hcpError(fields.problem), fields.status);
    const missing = identityProblem({ ...existing, ...fields });
    if (missing) return c.json(hcpError(missing), 422);

    const changed = Object.entries(fields).some(
      ([name, value]) => JSON.stringify(value) !== JSON.stringify(existing[name as keyof HcpCustomer]),
    );
    if (!changed) return c.json(customerResponse(existing, state().company, NOTHING_EXPANDED));
    const customer: HcpCustomer = { ...existing, ...fields, updated_at: now() };
    twin.record({ vendor: "housecallpro", type: "CustomerUpdated", data: { customer } }, "api");
    return c.json(customerResponse(customer, state().company, NOTHING_EXPANDED));
  });
}

const SORTABLE = ["created_at", "updated_at", "first_name", "last_name", "email", "company"] as const;
const EXPANDABLE = ["attachments", "do_not_service"];

/** A customer as the API answers with it: the record, the company it belongs to, and anything `expand` asked for. */
export function customerResponse(customer: HcpCustomer, company: HcpCompany, expand: ReadonlySet<string>) {
  return {
    ...customer,
    company_name: company.name,
    company_id: company.id,
    ...(expand.has("attachments") && { attachments: [] }), // the twin keeps no files
    ...(expand.has("do_not_service") && { do_not_service: false }),
  };
}

/**
 * `q`: "A query that can be used to search for a customer by name, email, mobile number and address." How Housecall Pro
 * matches isn't documented. The twin looks for the text, without regard to case, in the name, email, and addresses,
 * and for its digits in the mobile number, so "5552345678" finds "555-234-5678" (FIDELITY.md).
 */
function matchesSearch(customer: HcpCustomer, q: string): boolean {
  const needle = q.trim().toLowerCase();
  if (!needle) return true;
  const name = [customer.first_name, customer.last_name].filter(Boolean).join(" ");
  const addresses = customer.addresses.map((address) => ADDRESS_TEXT_FIELDS.map((field) => address[field] ?? "").join(" "));
  if ([name, customer.email ?? "", ...addresses].some((text) => text.toLowerCase().includes(needle))) return true;
  const digits = needle.replace(/[\s().+-]/g, "");
  return /^\d+$/.test(digits) && (customer.mobile_number ?? "").replace(/\D/g, "").includes(digits);
}
