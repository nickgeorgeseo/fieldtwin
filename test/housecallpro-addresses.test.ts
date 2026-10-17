import { describe, expect, it } from "vitest";
import { setup } from "./helpers.ts";

type Harness = ReturnType<typeof setup>;

const ADDRESS = { street: "40 Mill Creek Dr", street_line_2: "Unit 2", city: "Riverton", state: "NC", zip: "28214", country: "US" };

async function firstCustomer(hcpGet: Harness["hcpGet"]) {
  return (await (await hcpGet("/customers?page_size=1")).json()).customers[0] as { id: string; addresses: { id: string }[] };
}

describe("Housecall Pro twin: a customer's addresses", () => {
  it("lists a customer's addresses with the page counts", async () => {
    const { hcpGet } = setup();
    const customer = await firstCustomer(hcpGet);
    const body = await (await hcpGet(`/customers/${customer.id}/addresses`)).json();
    expect(body).toMatchObject({ page: 1, total_items: 1, total_pages: 1, addresses: customer.addresses });
  });

  it("adds an address to a customer, answering 200 with its new id, and shows it on the customer", async () => {
    const { hcpGet, hcpPost } = setup();
    const customer = await firstCustomer(hcpGet);
    const response = await hcpPost(`/customers/${customer.id}/addresses`, ADDRESS);
    expect(response.status).toBe(200);
    const address = await response.json();
    expect(address).toMatchObject({ ...ADDRESS, type: "service" });
    expect(address.id).toMatch(/^adr_[0-9a-f]{32}$/);

    const read = await (await hcpGet(`/customers/${customer.id}`)).json();
    expect(read.addresses.map((a: { id: string }) => a.id)).toEqual([customer.addresses[0]!.id, address.id]);
    expect(await (await hcpGet(`/customers/${customer.id}/addresses/${address.id}`)).json()).toEqual(address);
  });

  it("lists the newest address first by default, as the docs' sort_direction default says", async () => {
    const { hcpGet, hcpPost } = setup();
    const customer = await firstCustomer(hcpGet);
    const added = await (await hcpPost(`/customers/${customer.id}/addresses`, ADDRESS)).json();
    const listed = (await (await hcpGet(`/customers/${customer.id}/addresses`)).json()).addresses;
    expect(listed.map((a: { id: string }) => a.id)).toEqual([added.id, customer.addresses[0]!.id]);
  });

  it("refuses an address without the fields the docs require (422), naming them", async () => {
    const { hcpGet, hcpPost } = setup();
    const customer = await firstCustomer(hcpGet);
    const response = await hcpPost(`/customers/${customer.id}/addresses`, { street: "1 Oak St", city: "Riverton" });
    expect(response.status).toBe(422);
    expect((await response.json()).error.message).toMatch(/state, zip, country/);
  });

  it("answers 404 for the addresses of a customer that doesn't exist, and for an address it doesn't have", async () => {
    const { hcpGet, hcpPost } = setup();
    expect((await hcpGet("/customers/cus_missing/addresses")).status).toBe(404);
    expect((await hcpPost("/customers/cus_missing/addresses", ADDRESS)).status).toBe(404);
    const customer = await firstCustomer(hcpGet);
    const response = await hcpGet(`/customers/${customer.id}/addresses/adr_missing`);
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: { message: "address not found" } });
  });
});
