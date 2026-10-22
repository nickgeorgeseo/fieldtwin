import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { readBooks } from "../lib/books.ts";
import { matchCustomers, matchInvoices } from "../lib/match-books.ts";
import type { TwinEvent } from "../lib/twin-types.ts";

let seq = 0;
function event(vendor: string, type: string, data: unknown): TwinEvent {
  seq += 1;
  return { seq, vendor, type, data, source: "seed", at: "2026-07-13T11:00:00.000Z" };
}
const qboCustomer = (Id: string, DisplayName: string, email?: string, Active = true) => ({
  Id,
  DisplayName,
  Active,
  ...(email && { PrimaryEmailAddr: { Address: email } }),
});
const client = (n: number, firstName: string, lastName: string, email: string) => ({
  id: `client-${n}`,
  firstName,
  lastName,
  companyName: null,
  emails: [{ address: email, primary: true }],
});
const jobberInvoice = (invoiceNumber: string, clientId: string, totals: number[], paidAt: string | null) => ({
  id: `invoice-${invoiceNumber}`,
  invoiceNumber,
  clientId,
  subject: "AC tune-up",
  lineItems: totals.map((totalPrice) => ({ totalPrice })),
  paidAt,
});
const qboInvoice = (Id: string, DocNumber: string, customer: string, TotalAmt: number, Balance: number) => ({
  Id,
  DocNumber,
  CustomerRef: { value: "1", name: customer },
  TotalAmt,
  Balance,
});
const hcpCustomer = (n: number, first_name: string, last_name: string, email: string | null) => ({
  id: `cus_${n}`,
  first_name,
  last_name,
  email,
  company: null,
  mobile_number: null,
  home_number: null,
  work_number: null,
});
const hcpInvoice = (invoice_number: string, customer_id: string, unitPrices: number[], paid_at: string | null) => ({
  id: `invoice_${invoice_number}`,
  invoice_number,
  customer_id,
  items: unitPrices.map((unit_price) => ({ unit_price, quantity: 1 })),
  paid_at,
});

describe("rebuilding every vendor's books from the event log", () => {
  it("keeps the latest version of each record, since every event carries the whole record", () => {
    const books = readBooks([
      event("quickbooks", "CustomerCreated", { customer: qboCustomer("1", "Harper Alder") }),
      event("quickbooks", "CustomerUpdated", { customer: qboCustomer("1", "Harper Alder Jr"), requestId: "r1" }),
      event("jobber", "InvoiceCreated", { invoice: jobberInvoice("7", "client-1", [100], null) }),
      event("jobber", "InvoiceUpdated", { invoice: jobberInvoice("7", "client-1", [100], "2026-07-13T12:00:00Z") }),
      event("quickbooks", "CompanyCreated", { realmId: "9341000000000001", utcOffsetHours: -5 }),
    ]);
    assert.deepEqual(
      books.quickbooks.customers.map((customer) => customer.DisplayName),
      ["Harper Alder Jr"],
    );
    assert.equal(books.jobber.invoices[0]?.paidAt, "2026-07-13T12:00:00Z");
  });

  it("reads Housecall Pro's customers and invoices too", () => {
    const books = readBooks([
      event("housecallpro", "CustomerCreated", { customer: hcpCustomer(1, "Harper", "Alder", "harper@example.com") }),
      event("housecallpro", "CustomerUpdated", { customer: hcpCustomer(1, "Harper", "Alder Jr", "harper@example.com") }),
      event("housecallpro", "InvoiceCreated", { invoice: hcpInvoice("12", "cus_1", [9300], null) }),
    ]);
    assert.deepEqual(
      books.housecallpro.customers.map((customer) => customer.last_name),
      ["Alder Jr"],
    );
    assert.equal(books.housecallpro.invoices[0]?.invoice_number, "12");
  });
});

describe("matching customers across Jobber and QuickBooks by email", () => {
  const books = readBooks([
    event("jobber", "ClientCreated", { client: client(1, "Kendall", "Dunmore", "kendall@example.com") }),
    event("jobber", "ClientCreated", { client: client(2, "Jamie", "Lindqvist", "Jamie@Example.com") }),
    event("jobber", "ClientCreated", { client: client(3, "Quinn", "Brooks", "quinn@example.com") }),
    event("jobber", "ClientCreated", { client: client(4, "Sage", "Jessup", "sage@example.com") }),
    event("quickbooks", "CustomerCreated", { customer: qboCustomer("1", "Kendall Dunmore", "kendall@example.com") }),
    event("quickbooks", "CustomerCreated", { customer: qboCustomer("2", "Jamie Lindquist", "jamie@example.com") }),
    event("quickbooks", "CustomerCreated", { customer: qboCustomer("4", "Sage Jessup", "sage@example.com", false) }),
    event("quickbooks", "CustomerCreated", { customer: qboCustomer("5", "Rowan Stroud", "rowan@example.com") }),
    event("quickbooks", "CustomerCreated", { customer: qboCustomer("6", "Dana Whitfield") }),
  ]);
  const byEmail = Object.fromEntries(matchCustomers(books, "jobber").map((row) => [row.email || row.quickbooks?.name, row.status]));

  it("calls a customer with the same name in both the same", () => {
    assert.equal(byEmail["kendall@example.com"], "same");
  });

  it("matches a customer spelled differently, ignoring the email's case", () => {
    assert.equal(byEmail["jamie@example.com"], "spelled-differently");
  });

  it("finds customers only one system has", () => {
    assert.equal(byEmail["quinn@example.com"], "only-in-field-service");
    assert.equal(byEmail["rowan@example.com"], "only-in-quickbooks");
    assert.equal(byEmail["Dana Whitfield"], "only-in-quickbooks");
  });

  it("notices a customer QuickBooks has made inactive", () => {
    assert.equal(byEmail["sage@example.com"], "inactive-in-quickbooks");
  });

  it("lists the differences before the customers that agree", () => {
    assert.equal(matchCustomers(books, "jobber").at(-1)?.status, "same");
  });

  it("keeps a customer the books have twice under one email as a row of its own, since a sync that books one twice is the bug to catch", () => {
    const twice = readBooks([
      event("jobber", "ClientCreated", { client: client(1, "Kendall", "Dunmore", "kendall@example.com") }),
      event("quickbooks", "CustomerCreated", { customer: qboCustomer("1", "Kendall Dunmore", "kendall@example.com") }),
      event("quickbooks", "CustomerCreated", { customer: qboCustomer("2", "Kendall Dunmore", "Kendall@Example.com") }),
    ]);
    assert.deepEqual(
      matchCustomers(twice, "jobber").map((row) => [row.service?.id, row.quickbooks?.id, row.status]),
      [
        [undefined, "2", "only-in-quickbooks"],
        ["client-1", "1", "same"],
      ],
    );
  });

  it("keeps a field-service customer entered twice under one email as a row of its own too", () => {
    const twice = readBooks([
      event("housecallpro", "CustomerCreated", { customer: hcpCustomer(1, "Kendall", "Dunmore", "kendall@example.com") }),
      event("housecallpro", "CustomerCreated", { customer: hcpCustomer(2, "Kendall", "Dunmore", "KENDALL@example.com") }),
      event("quickbooks", "CustomerCreated", { customer: qboCustomer("1", "Kendall Dunmore", "kendall@example.com") }),
    ]);
    assert.deepEqual(
      matchCustomers(twice, "housecallpro").map((row) => [row.service?.id, row.quickbooks?.id, row.status]),
      [
        ["cus_2", undefined, "only-in-field-service"],
        ["cus_1", "1", "same"],
      ],
    );
  });
});

describe("matching invoices by Jobber's number and QuickBooks' DocNumber", () => {
  const paid = "2026-07-01T00:00:00Z";
  const books = readBooks([
    event("jobber", "ClientCreated", { client: client(1, "Kendall", "Dunmore", "kendall@example.com") }),
    event("jobber", "InvoiceCreated", { invoice: jobberInvoice("1", "client-1", [895, 60], paid) }),
    event("jobber", "InvoiceCreated", { invoice: jobberInvoice("2", "client-1", [93], paid) }),
    event("jobber", "InvoiceCreated", { invoice: jobberInvoice("3", "client-1", [110], null) }),
    event("jobber", "InvoiceCreated", { invoice: jobberInvoice("4", "client-1", [165], paid) }),
    event("jobber", "InvoiceCreated", { invoice: jobberInvoice("5", "client-1", [10.005, 10.005], null) }),
    event("jobber", "InvoiceCreated", { invoice: jobberInvoice("6", "client-1", [300], null) }),
    event("jobber", "InvoiceCreated", { invoice: jobberInvoice("7", "client-1", [400], null) }),
    event("quickbooks", "InvoiceCreated", { invoice: qboInvoice("1", "1", "Kendall Dunmore", 955, 0) }),
    event("quickbooks", "InvoiceCreated", { invoice: qboInvoice("2", "2", "Kendall Dunmore", 93, 93) }),
    event("quickbooks", "InvoiceCreated", { invoice: qboInvoice("3", "3", "Kendall Dunmore", 110, 110) }),
    event("quickbooks", "InvoiceCreated", { invoice: qboInvoice("5", "5", "Kendall Dunmore", 20.01, 20.01) }),
    event("quickbooks", "InvoiceCreated", { invoice: qboInvoice("6", "6", "Kendall Dunmore", 250, 250) }),
    event("quickbooks", "InvoiceCreated", { invoice: qboInvoice("29", "1001", "Dana Whitfield", 185, 185) }),
  ]);
  const byNumber = Object.fromEntries(matchInvoices(books, "jobber").map((row) => [row.number, row]));

  it("calls an invoice paid in both, or open in both, in sync", () => {
    assert.equal(byNumber["1"]?.status, "in-sync");
    assert.equal(byNumber["3"]?.status, "in-sync");
  });

  it("finds a payment Jobber took that the books haven't recorded", () => {
    assert.equal(byNumber["2"]?.status, "payment-not-recorded");
  });

  it("finds a paid invoice the books have never seen", () => {
    assert.equal(byNumber["4"]?.status, "paid-not-booked");
  });

  it("tells an open invoice the books haven't seen apart, since a sync may wait until it's paid", () => {
    assert.equal(byNumber["7"]?.status, "open-not-booked");
  });

  it("adds Jobber's lines to the cent before comparing totals", () => {
    assert.equal(byNumber["5"]?.service?.total, 20.01);
    assert.equal(byNumber["5"]?.status, "in-sync");
  });

  it("finds totals that disagree, and invoices only the books have", () => {
    assert.equal(byNumber["6"]?.status, "totals-differ");
    assert.equal(byNumber["1001"]?.status, "only-in-quickbooks");
  });

  it("names Jobber's client on each invoice", () => {
    assert.equal(byNumber["1"]?.service?.customer, "Kendall Dunmore");
  });

  it("keeps an invoice the books booked twice under one number, since QuickBooks accepts the second", () => {
    const twice = readBooks([
      event("jobber", "ClientCreated", { client: client(1, "Kendall", "Dunmore", "kendall@example.com") }),
      event("jobber", "InvoiceCreated", { invoice: jobberInvoice("1", "client-1", [955], paid) }),
      event("quickbooks", "InvoiceCreated", { invoice: qboInvoice("1", "1", "Kendall Dunmore", 955, 0) }),
      event("quickbooks", "InvoiceCreated", { invoice: qboInvoice("2", "1", "Kendall Dunmore", 955, 955) }),
    ]);
    assert.deepEqual(
      matchInvoices(twice, "jobber").map((row) => [row.number, row.quickbooks?.id, row.status]),
      [
        ["1", "2", "only-in-quickbooks"],
        ["1", "1", "in-sync"],
      ],
    );
  });
});

describe("comparing Housecall Pro with the books instead of Jobber", () => {
  const paid = "2026-07-01T00:00:00Z";
  const kendall = [
    event("housecallpro", "CustomerCreated", { customer: hcpCustomer(1, "Kendall", "Dunmore", "kendall@example.com") }),
    event("quickbooks", "CustomerCreated", { customer: qboCustomer("1", "Kendall Dunmore", "kendall@example.com") }),
  ];

  it("matches Housecall Pro's customers by email, leaving Jobber's out", () => {
    const books = readBooks([
      ...kendall,
      event("housecallpro", "CustomerCreated", { customer: hcpCustomer(2, "Jamie", "Lindqvist", "Jamie@Example.com") }),
      event("housecallpro", "CustomerCreated", { customer: hcpCustomer(3, "Quinn", "Brooks", "quinn@example.com") }),
      event("jobber", "ClientCreated", { client: client(4, "Sage", "Jessup", "sage@example.com") }),
      event("quickbooks", "CustomerCreated", { customer: qboCustomer("2", "Jamie Lindquist", "jamie@example.com") }),
    ]);
    assert.deepEqual(
      matchCustomers(books, "housecallpro").map((row) => [row.email, row.service?.name, row.status]),
      [
        ["quinn@example.com", "Quinn Brooks", "only-in-field-service"],
        ["jamie@example.com", "Jamie Lindqvist", "spelled-differently"],
        ["kendall@example.com", "Kendall Dunmore", "same"],
      ],
    );
  });

  it("turns Housecall Pro's cents into dollars before comparing totals", () => {
    const books = readBooks([
      ...kendall,
      event("housecallpro", "InvoiceCreated", { invoice: hcpInvoice("1", "cus_1", [89500, 6000], paid) }),
      event("quickbooks", "InvoiceCreated", { invoice: qboInvoice("1", "1", "Kendall Dunmore", 955, 0) }),
    ]);
    const [row] = matchInvoices(books, "housecallpro");
    assert.equal(row?.service?.total, 955);
    assert.equal(row?.status, "in-sync");
  });

  it("adds Housecall Pro's lines as the twin does, a half cent up, before comparing totals", () => {
    const invoice = { ...hcpInvoice("5", "cus_1", [], paid), items: [{ unit_price: 3450, quantity: 2.01 }] }; // 6934.4999... multiplied out
    const books = readBooks([
      ...kendall,
      event("housecallpro", "InvoiceCreated", { invoice }),
      event("quickbooks", "InvoiceCreated", { invoice: qboInvoice("5", "5", "Kendall Dunmore", 69.35, 0) }),
    ]);
    const [row] = matchInvoices(books, "housecallpro");
    assert.deepEqual([row?.service?.total, row?.status], [69.35, "in-sync"]);
  });

  it("pairs each invoice with the books' one under its number, as the books carry Housecall Pro's numbers", () => {
    const books = readBooks([
      ...kendall,
      event("housecallpro", "InvoiceCreated", { invoice: hcpInvoice("3", "cus_1", [9300], paid) }),
      event("housecallpro", "InvoiceCreated", { invoice: hcpInvoice("4", "cus_1", [9300], paid) }),
      event("quickbooks", "InvoiceCreated", { invoice: qboInvoice("3", "3", "Kendall Dunmore", 93, 0) }),
      event("quickbooks", "InvoiceCreated", { invoice: qboInvoice("2", "2", "Kendall Dunmore", 93, 0) }),
    ]);
    // #4 has the same customer and total as the books' #2, but another number: another invoice, which isn't booked yet.
    assert.deepEqual(
      matchInvoices(books, "housecallpro").map((row) => [row.number, row.quickbooks?.id, row.status]),
      [
        ["4", undefined, "paid-not-booked"],
        ["2", "2", "only-in-quickbooks"],
        ["3", "3", "in-sync"],
      ],
    );
  });

  it("finds an invoice booked under Housecall Pro's number for another total, as cents booked as dollars would be", () => {
    const books = readBooks([
      ...kendall,
      event("housecallpro", "InvoiceCreated", { invoice: hcpInvoice("45", "cus_1", [12300], paid) }),
      event("quickbooks", "InvoiceCreated", { invoice: qboInvoice("31", "45", "Kendall Dunmore", 12300, 0) }),
    ]);
    const [row] = matchInvoices(books, "housecallpro");
    assert.deepEqual([row?.service?.total, row?.quickbooks?.total, row?.status], [123, 12300, "totals-differ"]);
  });
});
