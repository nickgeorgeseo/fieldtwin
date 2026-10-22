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

  it("lists the oldest address first with sort_direction=asc, and by updated_at in the same order, since addresses never change", async () => {
    const { hcpGet, hcpPost } = setup();
    const customer = await firstCustomer(hcpGet);
    const added = await (await hcpPost(`/customers/${customer.id}/addresses`, ADDRESS)).json();
    const ids = async (query: string) =>
      ((await (await hcpGet(`/customers/${customer.id}/addresses?${query}`)).json()).addresses as { id: string }[]).map((a) => a.id);
    expect(await ids("sort_direction=asc")).toEqual([customer.addresses[0]!.id, added.id]);
    expect(await ids("sort_by=updated_at")).toEqual([added.id, customer.addresses[0]!.id]);
    expect(await ids("sort_by=updated_at&sort_direction=asc")).toEqual([customer.addresses[0]!.id, added.id]);
  });

  it("refuses an attribute it doesn't sort addresses by, naming the two it does", async () => {
    const { hcpGet } = setup();
    const customer = await firstCustomer(hcpGet);
    const response = await hcpGet(`/customers/${customer.id}/addresses?sort_by=street`);
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: { message: 'sort_by must be one of created_at, updated_at, not "street".' } });
  });

  it("refuses an address without the fields the docs require (422), naming them", async () => {
    const { hcpGet, hcpPost } = setup();
    const customer = await firstCustomer(hcpGet);
    const response = await hcpPost(`/customers/${customer.id}/addresses`, { street: "1 Oak St", city: "Riverton" });
    expect(response.status).toBe(422);
    expect((await response.json()).error.message).toMatch(/state, zip, country/);
  });

  it("refuses a field of the wrong type, like a zip sent as a number, and a required field that is only spaces", async () => {
    const { twin, hcpGet, hcpPost } = setup();
    const customer = await firstCustomer(hcpGet);
    const before = twin.log.length;
    const numberZip = await hcpPost(`/customers/${customer.id}/addresses`, { ...ADDRESS, zip: 28214 });
    expect(numberZip.status).toBe(422);
    expect((await numberZip.json()).error.message).toContain("address.zip");
    const blankState = await hcpPost(`/customers/${customer.id}/addresses`, { ...ADDRESS, state: "  " });
    expect(blankState.status).toBe(422);
    expect((await blankState.json()).error.message).toMatch(/Missing: state/);
    expect(twin.log.length).toBe(before);
  });

  it("takes latitude and longitude, which AddressCreate lists, and leaves them out of the Address it answers with", async () => {
    const { hcpGet, hcpPost } = setup();
    const customer = await firstCustomer(hcpGet);
    const response = await hcpPost(`/customers/${customer.id}/addresses`, { ...ADDRESS, latitude: 35.2271, longitude: -80.8431 });
    expect(response.status).toBe(200);
    const address = await response.json();
    expect(address).not.toHaveProperty("latitude");
    expect(address).not.toHaveProperty("longitude");
    expect(address).toMatchObject(ADDRESS);
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
