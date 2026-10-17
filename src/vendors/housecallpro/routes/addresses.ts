import type { Hono } from "hono";
import { readJsonObject } from "../../../core/request-body.ts";
import type { Twin } from "../../../core/twin.ts";
import { hcpError } from "../errors.ts";
import { hcpId } from "../ids.ts";
import type { HcpAddress, HcpState } from "../types/index.ts";
import { HCP } from "./base.ts";
import { readAddress } from "./customer-body.ts";
import { notFound } from "./customers.ts";
import { pageOf, readList } from "./lists.ts";

/**
 * A customer's addresses.
 * Get all:  https://docs.housecallpro.com/docs/housecall-public-api/abdc4e24d762b-get-all-of-a-customer-s-addresses
 * Create:   https://docs.housecallpro.com/docs/housecall-public-api/6cf593d8a90ca-create-an-address-on-a-customer
 * Get one:  https://docs.housecallpro.com/docs/housecall-public-api/721b19310aa3b-get-a-customer-s-address
 */
export function addressRoutes(app: Hono, twin: Twin): void {
  const state = () => twin.state<HcpState>("housecallpro");

  // Addresses sort by created_at or updated_at. The twin never changes an address, so both are the order they were
  // added in, and the list keeps it.
  app.get(`${HCP}/customers/:id/addresses`, (c) => {
    const customer = state().customers.get(c.req.param("id"));
    if (!customer) return notFound(c);
    const list = readList(c.req, { sortable: ["created_at", "updated_at"], sortBy: "created_at", expandable: [] });
    if ("problem" in list) return c.json(hcpError(list.problem), 400);
    const addresses = list.sort.descending ? [...customer.addresses].reverse() : customer.addresses;
    return c.json(pageOf("addresses", addresses, list.paging, (address) => address));
  });

  // AddressCreate requires every one of these, and the documented answer is 200 with the new Address (not 201).
  app.post(`${HCP}/customers/:id/addresses`, async (c) => {
    const customer = state().customers.get(c.req.param("id"));
    if (!customer) return notFound(c);
    const read = await readJsonObject(c, '{"street": "12 Elm St", "city": "Riverton", "state": "NC", "zip": "28201", "country": "US"}');
    if ("problem" in read) return c.json(hcpError(read.problem), 400);
    const fields = readAddress(read.body, "address");
    if ("problem" in fields) return c.json(hcpError(fields.problem), 422);
    const missing = REQUIRED.filter((name) => !fields[name]?.trim());
    if (missing.length) return c.json(hcpError(`An address needs ${REQUIRED.join(", ")}. Missing: ${missing.join(", ")}.`), 422);

    // latitude and longitude are accepted and dropped: the Address the API answers with has neither.
    const address: HcpAddress = { id: hcpId("adr", state().counts.addresses + 1), type: "service", ...fields };
    twin.record({ vendor: "housecallpro", type: "AddressCreated", data: { customerId: customer.id, address } }, "api");
    return c.json(address, 200);
  });

  app.get(`${HCP}/customers/:id/addresses/:addressId`, (c) => {
    const customer = state().customers.get(c.req.param("id"));
    if (!customer) return notFound(c);
    const address = customer.addresses.find((candidate) => candidate.id === c.req.param("addressId"));
    return address ? c.json(address) : notFound(c, "address");
  });
}

const REQUIRED = ["street", "city", "state", "zip", "country"] as const;
