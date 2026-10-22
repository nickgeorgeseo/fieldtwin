import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { loadScenario } from "../src/control/operations.ts";
import { listAll } from "./hcp-helpers.ts";
import { setup } from "./helpers.ts";

type Harness = ReturnType<typeof setup>;

const allCustomers = (hcpGet: Harness["hcpGet"]) => listAll<{ id: string; first_name: string; email: string }>(hcpGet, "customers");

describe("Housecall Pro twin: listing customers", () => {
  it("lists the business's customers ten to a page by default, with the page counts", async () => {
    const { twin, hcpGet } = setup();
    const body = await (await hcpGet("/customers")).json();
    expect(body).toMatchObject({ page: 1, page_size: 10, total_items: twin.world.customers.length, total_pages: 3 });
    expect(body.customers).toHaveLength(10);
    expect(body.customers[0]).toMatchObject({ company_name: twin.world.company.name, tags: [], addresses: [{ type: "service" }] });
    expect(body.customers[0].id).toMatch(/^cus_[0-9a-f]{32}$/);
  });

  it("pages through every customer once with page and page_size", async () => {
    const { twin, hcpGet } = setup();
    const seen: string[] = [];
    for (let page = 1; page <= 4; page++) {
      const body = await (await hcpGet(`/customers?page=${page}&page_size=7`)).json();
      expect(body.total_pages).toBe(4);
      seen.push(...body.customers.map((customer: { id: string }) => customer.id));
    }
    expect(new Set(seen).size).toBe(twin.world.customers.length);
    expect((await (await hcpGet("/customers?page=5&page_size=7")).json()).customers).toEqual([]);
  });

  it("refuses a page or page_size below 1, or too large to count, since pages count from 1", async () => {
    const { hcpGet } = setup();
    for (const query of ["page=0", "page_size=0", "page=two", `page_size=${"9".repeat(400)}`, `page=${"9".repeat(30)}`]) {
      const response = await hcpGet(`/customers?${query}`);
      expect(response.status, query).toBe(400);
      expect((await response.json()).error.message).toMatch(/whole number of 1 or more/);
    }
  });

  it("lists newest first by default, and oldest first with sort_direction=asc", async () => {
    const { hcpGet, hcpPost } = setup();
    const created = await (await hcpPost("/customers", { first_name: "Newest", last_name: "Arrival" })).json();
    const newestFirst = await allCustomers(hcpGet);
    expect(newestFirst[0]!.id).toBe(created.id);
    const oldestFirst = (await (await hcpGet("/customers?page_size=1000&sort_direction=asc")).json()).customers;
    expect(oldestFirst.at(-1).id).toBe(created.id);
    expect(oldestFirst.map((customer: { id: string }) => customer.id)).toEqual(newestFirst.map((customer) => customer.id).reverse());
  });

  it("sorts by a name or email when asked, and refuses an attribute it doesn't sort by", async () => {
    const { hcpGet } = setup();
    const byName = (await (await hcpGet("/customers?page_size=1000&sort_by=first_name&sort_direction=asc")).json()).customers;
    const names = byName.map((customer: { first_name: string }) => customer.first_name);
    expect(names).toEqual([...names].sort((a, b) => a.localeCompare(b)));

    const response = await hcpGet("/customers?sort_by=shoe_size");
    expect(response.status).toBe(400);
    expect((await response.json()).error.message).toMatch(/sort_by.*first_name/);
  });

  it("ignores an empty expand value, as it does an empty filter, but refuses one it doesn't document", async () => {
    const { hcpGet } = setup();
    expect((await hcpGet("/customers?expand[]=")).status).toBe(200);
    expect((await hcpGet("/customers?expand[]=&expand[]=attachments")).status).toBe(200);
    expect((await hcpGet("/customers?expand[]=appointments")).status).toBe(400);
  });

  it("adds attachments and do_not_service to each customer only when expand asks for them", async () => {
    const { hcpGet } = setup();
    const plain = (await (await hcpGet("/customers?page_size=1")).json()).customers[0];
    expect(plain).not.toHaveProperty("attachments");
    expect(plain).not.toHaveProperty("do_not_service");
    const expanded = (await (await hcpGet("/customers?page_size=1&expand[]=attachments&expand[]=do_not_service")).json()).customers[0];
    expect(expanded).toEqual({ ...plain, attachments: [], do_not_service: false });
    const one = await (await hcpGet(`/customers/${plain.id}?expand[]=do_not_service`)).json();
    expect(one).toEqual({ ...plain, do_not_service: false });
  });

  it("sorts by last name or email when asked", async () => {
    const { hcpGet } = setup();
    const byLastName = (await (await hcpGet("/customers?page_size=1000&sort_by=last_name&sort_direction=asc")).json()).customers;
    const lastNames = byLastName.map((customer: { last_name: string }) => customer.last_name.toLowerCase());
    expect(lastNames).toEqual([...lastNames].sort());
    const byEmail = (await (await hcpGet("/customers?page_size=1000&sort_by=email")).json()).customers;
    const emails = byEmail.map((customer: { email: string }) => customer.email);
    expect(emails).toEqual([...emails].sort().reverse());
  });

  it("refuses a sort direction other than asc or desc, saying so", async () => {
    const { hcpGet } = setup();
    const response = await hcpGet("/customers?sort_direction=sideways");
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: { message: 'sort_direction must be asc or desc, not "sideways".' } });
  });

  it("answers a search that finds nobody with an empty page and no pages at all", async () => {
    const { hcpGet } = setup();
    expect(await (await hcpGet("/customers?q=nobody")).json()).toEqual({
      page: 1,
      page_size: 10,
      total_pages: 0,
      total_items: 0,
      customers: [],
    });
  });

  it("checks the page before the sort, so a request with both wrong hears about the page first", async () => {
    const { hcpGet } = setup();
    const response = await hcpGet("/customers?sort_by=bogus&page=0");
    expect(response.status).toBe(400);
    expect((await response.json()).error.message).toMatch(/^page must be a whole number/);
  });

  it("finds customers by name, email, mobile number, or address with q", async () => {
    const { twin, hcpGet } = setup();
    const person = twin.world.customers[3]!;
    const search = async (q: string) =>
      ((await (await hcpGet(`/customers?q=${encodeURIComponent(q)}`)).json()).customers as { email: string }[]).map((c) => c.email);

    expect(await search(`${person.firstName} ${person.lastName}`.toUpperCase())).toContain(person.email);
    expect(await search(person.email)).toEqual([person.email]);
    expect(await search(person.phone.replace(/-/g, ""))).toContain(person.email);
    expect(await search(person.street)).toContain(person.email);
    expect(await search("nobody-by-this-name")).toEqual([]);
  });
});

describe("Housecall Pro twin: one customer", () => {
  it("reads a customer by id, with the world's details", async () => {
    const { twin, hcpGet } = setup();
    const person = twin.world.customers[0]!;
    const listed = (await allCustomers(hcpGet)).find((customer) => customer.email === person.email)!;
    const customer = await (await hcpGet(`/customers/${listed.id}`)).json();
    expect(customer).toMatchObject({
      first_name: person.firstName,
      last_name: person.lastName,
      mobile_number: person.phone,
      addresses: [{ street: person.street, city: person.city, state: person.state, zip: person.postalCode, country: "US" }],
    });
  });

  it("answers 404 in Housecall Pro's error format for a customer that doesn't exist", async () => {
    const { hcpGet } = setup();
    const response = await hcpGet("/customers/cus_00000000000000000000000000000000");
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: { message: "customer not found" } });
  });

  it("looks the customer up before reading expand, so a missing customer is a 404 whatever else is wrong", async () => {
    const { hcpGet } = setup();
    expect((await hcpGet("/customers/cus_missing?expand[]=bogus")).status).toBe(404);
  });

  it("refuses an expand value Get Customer doesn't document, like jobs", async () => {
    const { hcpGet } = setup();
    const [first] = await allCustomers(hcpGet);
    const response = await hcpGet(`/customers/${first!.id}?expand[]=jobs`);
    expect(response.status).toBe(400);
    expect((await response.json()).error.message).toBe('expand takes attachments and do_not_service, not "jobs".');
  });

  it("leaves out customers only the books know, like the other field-service twin", async () => {
    const harness = setup();
    loadScenario(harness.twin, readFileSync("scenarios/mismatched-books.yaml", "utf8"));
    const emails = (await allCustomers(harness.hcpGet)).map((customer) => customer.email);
    const { world } = harness.twin;
    for (const key of world.drift.accountingOnly) expect(emails).not.toContain(world.customers.find((c) => c.key === key)!.email);
    for (const key of world.drift.fieldServiceOnly) expect(emails).toContain(world.customers.find((c) => c.key === key)!.email);
  });
});

describe("Housecall Pro twin: creating and updating customers", () => {
  it("creates a customer, answering 201 with its new id and timestamps", async () => {
    const { twin, hcpPost } = setup();
    const response = await hcpPost("/customers", { first_name: "Dana", last_name: "Whitfield", email: "dana@example.com", tags: ["vip"] });
    expect(response.status).toBe(201);
    const customer = await response.json();
    expect(customer).toMatchObject({ first_name: "Dana", last_name: "Whitfield", email: "dana@example.com", tags: ["vip"], addresses: [] });
    expect(customer.id).toMatch(/^cus_[0-9a-f]{32}$/);
    expect(customer.created_at).toBe("2026-07-13T11:00:00Z");
    expect(twin.log.all().at(-1)).toMatchObject({ vendor: "housecallpro", type: "CustomerCreated", source: "api" });
  });

  it("gives each address sent with a new customer an id of its own", async () => {
    const { hcpPost } = setup();
    const address = { street: "12 Elm St", city: "Riverton", state: "NC", zip: "28201", country: "US" };
    const customer = await (
      await hcpPost("/customers", { first_name: "Ada", addresses: [address, { ...address, street: "14 Elm St" }] })
    ).json();
    expect(customer.addresses).toHaveLength(2);
    expect(customer.addresses[0]).toMatchObject({ ...address, type: "service" });
    expect(customer.addresses[0].id).not.toBe(customer.addresses[1].id);
  });

  it("refuses a customer with no name, email, or phone number (422), as the docs require one of them", async () => {
    const { twin, hcpPost } = setup();
    const before = twin.log.length;
    const response = await hcpPost("/customers", { company: "Nameless LLC", notes: "no way to reach them" });
    expect(response.status).toBe(422);
    expect((await response.json()).error.message).toMatch(/first_name, last_name, email, mobile_number, home_number, or work_number/);
    expect(twin.log.length).toBe(before);
  });

  it("reads null tags or notifications_enabled as not sent when creating, and null tags as none when updating", async () => {
    const { hcpPost, hcpPut } = setup();
    const created = await hcpPost("/customers", { first_name: "Nulls", tags: null, notifications_enabled: null });
    expect(created.status).toBe(201);
    const customer = await created.json();
    expect(customer).toMatchObject({ tags: [], notifications_enabled: false });
    await hcpPut(`/customers/${customer.id}`, { tags: ["vip"] });
    expect(await (await hcpPut(`/customers/${customer.id}`, { tags: null, notifications_enabled: null })).json()).toMatchObject({
      tags: [],
      notifications_enabled: false,
    });
  });

  it("refuses a field of the wrong type, naming it", async () => {
    const { hcpPost } = setup();
    for (const [body, field] of [
      [{ first_name: 42 }, "first_name"],
      [{ first_name: "Ada", tags: "vip" }, "tags"],
      [{ first_name: "Ada", notifications_enabled: "yes" }, "notifications_enabled"],
      [{ first_name: "Ada", addresses: [{ street: 12 }] }, "addresses[0].street"],
    ] as const) {
      const response = await hcpPost("/customers", body);
      expect(response.status, field).toBe(422);
      expect((await response.json()).error.message).toContain(field);
    }
  });

  it("refuses addresses that aren't a list of address objects, naming which", async () => {
    const { hcpPost } = setup();
    const asText = await hcpPost("/customers", { first_name: "Ada", addresses: "12 Elm St" });
    expect(asText.status).toBe(422);
    expect((await asText.json()).error.message).toMatch(/^addresses must be a list/);
    const ofText = await hcpPost("/customers", { first_name: "Ada", addresses: ["12 Elm St"] });
    expect(ofText.status).toBe(422);
    expect((await ofText.json()).error.message).toMatch(/^addresses\[0\] must be an address object/);
  });

  it("refuses a body that isn't a JSON object, saying what to send", async () => {
    const { app } = setup();
    const response = await app.request("/housecallpro/customers", {
      method: "POST",
      headers: { Authorization: "Token test-key", "Content-Type": "application/json" },
      body: "{not json",
    });
    expect(response.status).toBe(400);
    expect((await response.json()).error.message).toMatch(/isn't valid JSON/);
  });

  it("refuses an update of the wrong type, naming the field, or one that isn't JSON at all", async () => {
    const { app, hcpGet, hcpPut } = setup();
    const [first] = await allCustomers(hcpGet);
    const wrongType = await hcpPut(`/customers/${first!.id}`, { first_name: 42 });
    expect(wrongType.status).toBe(422);
    expect((await wrongType.json()).error.message).toContain("first_name");
    const notJson = await app.request(`/housecallpro/customers/${first!.id}`, {
      method: "PUT",
      headers: { Authorization: "Token test-key", "Content-Type": "application/json" },
      body: "{not json",
    });
    expect(notJson.status).toBe(400);
    expect((await notJson.json()).error.message).toMatch(/isn't valid JSON/);
  });

  it("changes only the fields a PUT sends, clears the ones it sets to null, and moves updated_at", async () => {
    const { twin, hcpGet, hcpPut } = setup();
    const [first] = await allCustomers(hcpGet);
    const before = await (await hcpGet(`/customers/${first!.id}`)).json();
    twin.clock.advance(60_000);

    const response = await hcpPut(`/customers/${first!.id}`, { last_name: "Renamed", mobile_number: null });
    expect(response.status).toBe(200);
    const after = await response.json();
    expect(after).toMatchObject({ first_name: before.first_name, email: before.email, last_name: "Renamed", mobile_number: null });
    expect(after.addresses).toEqual(before.addresses);
    expect(after.updated_at).toBe("2026-07-13T11:01:00Z");
    expect(after.created_at).toBe(before.created_at);
    expect(await (await hcpGet(`/customers/${first!.id}`)).json()).toEqual(after);
  });

  it("refuses an update that would leave no name, email, or phone number", async () => {
    const { hcpPost, hcpPut } = setup();
    const created = await (await hcpPost("/customers", { email: "only@example.com" })).json();
    const response = await hcpPut(`/customers/${created.id}`, { email: null });
    expect(response.status).toBe(422);
  });

  it("answers 404 for an update to a customer that doesn't exist", async () => {
    const { hcpPut } = setup();
    expect((await hcpPut("/customers/cus_missing", { first_name: "Nobody" })).status).toBe(404);
  });
});
