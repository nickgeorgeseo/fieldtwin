import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { describeEvent, filterEvents, parseLog } from "../lib/events.ts";
import type { TwinEvent } from "../lib/twin-types.ts";

function event(seq: number, vendor: string, type: string, data: unknown, source = "api"): TwinEvent {
  return { seq, vendor, type, data, source, at: "2026-07-13T11:00:00.000Z" };
}

describe("reading the event log", () => {
  it("reads one event per line and skips blank lines", () => {
    const events = parseLog('{"seq":1,"vendor":"jobber","type":"AccountCreated","data":{},"at":"x","source":"seed"}\n\n{"seq":2}\n');
    assert.deepEqual(
      events.map((read) => read.seq),
      [1, 2],
    );
    assert.deepEqual(parseLog(""), []);
  });
});

describe("saying what an event is about", () => {
  it("names a QuickBooks customer by its display name and Id", () => {
    assert.equal(
      describeEvent(event(1, "quickbooks", "CustomerCreated", { customer: { Id: "26", DisplayName: "Dana Whitfield" } })),
      'Id=26 "Dana Whitfield"',
    );
  });

  it("names a Jobber client by first and last name, or by company", () => {
    assert.equal(
      describeEvent(event(1, "jobber", "ClientCreated", { client: { id: "Z2lk", firstName: "Kendall", lastName: "Dunmore" } })),
      '"Kendall Dunmore"',
    );
    assert.equal(
      describeEvent(event(1, "jobber", "ClientCreated", { client: { firstName: null, lastName: null, companyName: "Acme" } })),
      '"Acme"',
    );
  });

  it("names a Jobber account by its name, and a team member by their full name", () => {
    assert.equal(
      describeEvent(event(1, "jobber", "AccountCreated", { account: { id: "Z2lk", name: "Thorne Heating & Air" } })),
      '"Thorne Heating & Air"',
    );
    assert.equal(
      describeEvent(
        event(1, "jobber", "UserCreated", { user: { name: { first: "Jordan", last: "Kettering", full: "Jordan Kettering" } } }),
      ),
      '"Jordan Kettering"',
    );
  });

  it("numbers invoices, jobs, and quotes the way each vendor does", () => {
    assert.equal(
      describeEvent(event(1, "jobber", "InvoiceUpdated", { invoice: { invoiceNumber: "13", subject: "AC tune-up" } })),
      '#13 "AC tune-up"',
    );
    assert.equal(describeEvent(event(1, "jobber", "JobCreated", { job: { jobNumber: 4, title: "Panel upgrade" } })), '#4 "Panel upgrade"');
    assert.equal(
      describeEvent(
        event(1, "quickbooks", "InvoiceCreated", {
          invoice: { Id: "29", DocNumber: "1001", CustomerRef: { name: "Dana Whitfield" }, TotalAmt: 185 },
        }),
      ),
      'Id=29 DocNumber=1001 "Dana Whitfield" 185.00',
    );
  });

  it("says who paid and how much for a payment", () => {
    assert.equal(
      describeEvent(
        event(1, "quickbooks", "PaymentCreated", { payment: { Id: "19", CustomerRef: { name: "Riley Northcott" }, TotalAmt: 955 } }),
      ),
      'Id=19 "Riley Northcott" 955.00',
    );
  });

  it("names a Housecall Pro company, customer, and employee by name", () => {
    assert.equal(
      describeEvent(event(1, "housecallpro", "CompanyCreated", { company: { id: "f199", name: "Rowntree Electric" } })),
      '"Rowntree Electric"',
    );
    assert.equal(
      describeEvent(
        event(1, "housecallpro", "CustomerUpdated", { customer: { id: "cus_cd98", first_name: "Kendall", last_name: "Dunmore" } }),
      ),
      '"Kendall Dunmore"',
    );
    assert.equal(
      describeEvent(
        event(1, "housecallpro", "EmployeeCreated", {
          employee: { id: "pro_b9d8", first_name: "Jordan", last_name: "Kettering", email: "jordan@example.com", role: "field tech" },
        }),
      ),
      '"Jordan Kettering"',
    );
  });

  it("names a Housecall Pro customer with no name by their company, email, or phone, as Housecall Pro does", () => {
    const customer = (fields: object) =>
      describeEvent(
        event(1, "housecallpro", "CustomerCreated", { customer: { first_name: null, last_name: null, company: null, ...fields } }),
      );
    assert.equal(customer({ company: "Acme" }), '"Acme"');
    assert.equal(customer({ email: "pat@example.com", mobile_number: "555-0100" }), '"pat@example.com"');
    assert.equal(customer({ email: null, mobile_number: "555-0100" }), '"555-0100"');
  });

  it("says where a Housecall Pro address is, though the customer's id comes first", () => {
    assert.equal(
      describeEvent(
        event(1, "housecallpro", "AddressCreated", {
          customerId: "cus_cd98",
          address: { id: "adr_a5e9", street: "6284 Pine Hollow Rd", city: "Oak Hollow", state: "TX" },
        }),
      ),
      '"6284 Pine Hollow Rd, Oak Hollow"',
    );
  });

  it("numbers Housecall Pro jobs, estimates, and invoices, and turns their cents into dollars", () => {
    assert.equal(
      describeEvent(event(1, "housecallpro", "JobCreated", { job: { invoice_number: "12", description: "AC tune-up" } })),
      '#12 "AC tune-up"',
    );
    assert.equal(describeEvent(event(1, "housecallpro", "JobCreated", { job: { invoice_number: "45", description: null } })), "#45");
    assert.equal(
      describeEvent(
        event(1, "housecallpro", "EstimateCreated", {
          estimate: {
            estimate_number: "7",
            options: [{ line_items: [{ unit_price: 45000, quantity: 1 }] }, { line_items: [{ unit_price: 26000, quantity: 2 }] }],
          },
        }),
      ),
      "#7 450.00 or 520.00",
    );
    assert.equal(
      describeEvent(
        event(1, "housecallpro", "InvoiceCreated", {
          invoice: {
            invoice_number: "12",
            items: [
              { unit_price: 9300, quantity: 1 },
              { unit_price: 2550, quantity: 1.5 },
            ],
          },
        }),
      ),
      "#12 131.25",
    );
  });

  it("rounds a Housecall Pro line's half cent up, as the twin does, though the float multiplied out falls just short", () => {
    const invoice = { invoice_number: "12", items: [{ unit_price: 3450, quantity: 2.01 }] }; // 2.01 × 3450 is 6934.4999... cents
    assert.equal(describeEvent(event(1, "housecallpro", "InvoiceCreated", { invoice })), "#12 69.35");
  });

  it("says nothing it can't back up when the record is unfamiliar", () => {
    assert.equal(describeEvent(event(1, "quickbooks", "CompanyCreated", { realmId: "9341000000000001" })), "");
  });
});

describe("filtering the feed", () => {
  const events = [
    event(1, "quickbooks", "CustomerCreated", { customer: { Id: "1", DisplayName: "Kendall Dunmore" } }, "seed"),
    event(2, "jobber", "ClientCreated", { client: { firstName: "Quinn", lastName: "Brooks" } }, "scenario"),
    event(3, "quickbooks", "CustomerUpdated", { customer: { Id: "3", DisplayName: "Harper Alder Jr" } }, "api"),
  ];

  it("keeps the vendors and sources asked for", () => {
    assert.deepEqual(
      filterEvents(events, { vendor: "quickbooks", sources: ["api", "seed"], search: "" }).map((kept) => kept.seq),
      [1, 3],
    );
    assert.deepEqual(
      filterEvents(events, { vendor: "", sources: ["scenario"], search: "" }).map((kept) => kept.seq),
      [2],
    );
  });

  it("finds a search anywhere in the event, ignoring case", () => {
    assert.deepEqual(
      filterEvents(events, { vendor: "", sources: ["seed", "scenario", "api"], search: "brooks" }).map((kept) => kept.seq),
      [2],
    );
    assert.deepEqual(
      filterEvents(events, { vendor: "", sources: ["seed", "scenario", "api"], search: "customerupdated" }).map((kept) => kept.seq),
      [3],
    );
  });
});
