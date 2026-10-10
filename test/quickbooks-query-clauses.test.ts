import { describe, expect, it } from "vitest";
import { parseQboQuery } from "../src/vendors/quickbooks/query-language.ts";
import { setup } from "./helpers.ts";

/**
 * AND, comparisons, LIKE, and ORDERBY, from the query docs' own examples:
 * https://developer.intuit.com/app/developer/qbo/docs/learn/explore-the-quickbooks-online-api/data-queries
 */

type Harness = ReturnType<typeof setup>;

const query = async (harness: Harness, statement: string) => {
  const response = await harness.qboGet(`/query?query=${encodeURIComponent(statement)}`);
  return { status: response.status, body: await response.json() };
};
const sale = (Amount: number) => ({ DetailType: "SalesItemLineDetail", Amount, SalesItemLineDetail: { ItemRef: { value: "1" } } });

/** A new customer with three invoices of its own, so filters and sorts see only these. */
async function customerWithInvoices(harness: Harness) {
  const { Customer } = await (await harness.qboPost("/customer", { DisplayName: "Query Clause Customer" })).json();
  for (const [TxnDate, amount, DocNumber] of [
    ["2026-07-01", 50, "Q-1"],
    ["2026-06-30", 60, "Q-2"],
    ["2026-07-01", 75, "Q-3"],
  ] as const) {
    await harness.qboPost("/invoice", { CustomerRef: { value: Customer.Id }, TxnDate, DocNumber, Line: [sale(amount)] });
  }
  return Customer.Id as string;
}
const docNumbers = (body: { QueryResponse: { Invoice?: { DocNumber: string }[] } }) =>
  (body.QueryResponse.Invoice ?? []).map((invoice) => invoice.DocNumber);

describe("QuickBooks query clause: AND", () => {
  it("parses several conditions joined by AND, as in the documented GivenName LIKE 'K%h' AND FamilyName LIKE 'Palm%'", () => {
    expect(parseQboQuery("SELECT * FROM Customer WHERE GivenName LIKE 'K%h' AND FamilyName LIKE 'Palm%'")).toMatchObject({
      where: [
        { property: "GivenName", operator: "like", values: ["K%h"] },
        { property: "FamilyName", operator: "like", values: ["Palm%"] },
      ],
    });
  });

  it("returns only records that meet every condition", async () => {
    const harness = setup();
    const customer = await customerWithInvoices(harness);
    const { body } = await query(harness, `select * from Invoice where CustomerRef = '${customer}' and TotalAmt > '55'`);
    expect(docNumbers(body)).toEqual(["Q-2", "Q-3"]);
  });

  it("has no OR, and says to use IN for several values instead (4000)", async () => {
    const { status, body } = await query(setup(), "select * from Customer where GivenName = 'a' or GivenName = 'b'");
    expect(status).toBe(400);
    expect(body.Fault.Error[0]).toMatchObject({ code: "4000" });
    expect(body.Fault.Error[0].Detail).toContain("IN (");
  });
});

describe("QuickBooks query clause: <, >, <=, >=", () => {
  it("compares numbers by value, as in the documented TotalAmt > '1000.0'", async () => {
    const harness = setup();
    const customer = await customerWithInvoices(harness);
    const { body } = await query(harness, `select * from Invoice where CustomerRef = '${customer}' and TotalAmt <= '60.0'`);
    expect(docNumbers(body)).toEqual(["Q-1", "Q-2"]);
  });

  it("compares dates, as in the documented TxnDate > '2011-01-01'", async () => {
    const harness = setup();
    const customer = await customerWithInvoices(harness);
    const { body } = await query(harness, `select * from Invoice where CustomerRef = '${customer}' and TxnDate >= '2026-07-01'`);
    expect(docNumbers(body)).toEqual(["Q-1", "Q-3"]);
  });

  it("compares MetaData times as instants, whatever offset the query writes them with", async () => {
    const harness = setup();
    harness.twin.clock.advance(3_600_000); // 12:00 UTC
    await harness.qboPost("/customer", { DisplayName: "Created At Noon" });
    const statement = "select * from Customer where MetaData.CreateTime > '2026-07-13T07:30:00-0400'"; // 11:30 UTC
    const { body } = await query(harness, statement);
    expect(body.QueryResponse.Customer.map((customer: { DisplayName: string }) => customer.DisplayName)).toEqual(["Created At Noon"]);
  });

  it("answers 4001 for a time it can't read, rather than matching nothing", async () => {
    const { status, body } = await query(setup(), "select * from Customer where MetaData.LastUpdatedTime > 'yesterday'");
    expect(status).toBe(400);
    expect(body.Fault.Error[0]).toMatchObject({ code: "4001" });
    expect(body.Fault.Error[0].Detail).toContain("yesterday");
  });

  it("rejects range operators and LIKE on Id, which QuickBooks allows only = and IN on (4001)", async () => {
    for (const statement of ["select * from Customer where Id > '3'", "select * from Customer where Id like '1%'"]) {
      const { status, body } = await query(setup(), statement);
      expect(status).toBe(400);
      expect(body.Fault.Error[0]).toMatchObject({ code: "4001" });
      expect(body.Fault.Error[0].Detail).toContain("= and IN");
    }
  });
});

describe("QuickBooks query clause: LIKE", () => {
  it("matches % against any run of characters, without regard to case", async () => {
    const harness = setup();
    for (const [GivenName, FamilyName] of [
      ["Kenneth", "Palmer"],
      ["Keith", "Palmateer"],
      ["Kara", "Palm"],
      ["Kenneth", "Smith"],
    ]) {
      await harness.qboPost("/customer", { GivenName, FamilyName });
    }
    const { body } = await query(harness, "SELECT * FROM Customer WHERE GivenName LIKE 'k%H' AND FamilyName LIKE 'PALM%'");
    expect(body.QueryResponse.Customer.map((customer: { DisplayName: string }) => customer.DisplayName)).toEqual([
      "Kenneth Palmer",
      "Keith Palmateer",
    ]);
  });

  it("treats every other character in a pattern literally", async () => {
    const harness = setup();
    await harness.qboPost("/customer", { DisplayName: "A.B. Cooling (East)" });
    await harness.qboPost("/customer", { DisplayName: "AxBx Cooling" });
    const { body } = await query(harness, "select * from Customer where DisplayName like 'A.B.%(East)'");
    expect(body.QueryResponse.Customer.map((customer: { DisplayName: string }) => customer.DisplayName)).toEqual(["A.B. Cooling (East)"]);
  });
});

describe("QuickBooks query clause: ORDERBY", () => {
  it("sorts ascending by default, as documented", async () => {
    const harness = setup();
    const customer = await customerWithInvoices(harness);
    const { body } = await query(harness, `select * from Invoice where CustomerRef = '${customer}' orderby TotalAmt`);
    expect(docNumbers(body)).toEqual(["Q-1", "Q-2", "Q-3"]);
  });

  it("sorts descending with DESC, and by each property in turn", async () => {
    const harness = setup();
    const customer = await customerWithInvoices(harness);
    const { body } = await query(harness, `select * from Invoice where CustomerRef = '${customer}' orderby TxnDate desc, TotalAmt desc`);
    expect(docNumbers(body)).toEqual(["Q-3", "Q-1", "Q-2"]);
  });

  it("sorts before it pages, so STARTPOSITION walks the sorted results", async () => {
    const harness = setup();
    const customer = await customerWithInvoices(harness);
    const statement = `select * from Invoice where CustomerRef = '${customer}' orderby TotalAmt desc startposition 2 maxresults 1`;
    expect(docNumbers((await query(harness, statement)).body)).toEqual(["Q-2"]);
  });

  it("sorts text without regard to case", async () => {
    const harness = setup();
    for (const DisplayName of ["zz beta", "ZZ Alpha", "zz Gamma"]) await harness.qboPost("/customer", { DisplayName });
    const { body } = await query(harness, "select * from Customer where DisplayName like 'zz%' orderby DisplayName");
    expect(body.QueryResponse.Customer.map((customer: { DisplayName: string }) => customer.DisplayName)).toEqual([
      "ZZ Alpha",
      "zz beta",
      "zz Gamma",
    ]);
  });

  it("answers 4001 for a property the twin can't sort by", async () => {
    const { status, body } = await query(setup(), "select * from Customer orderby ShoeSize");
    expect(status).toBe(400);
    expect(body.Fault.Error[0]).toMatchObject({ code: "4001" });
  });

  it("says to write ORDERBY as one word, the way the docs do (4000)", async () => {
    const { body } = await query(setup(), "select * from Customer order by DisplayName");
    expect(body.Fault.Error[0]).toMatchObject({ code: "4000" });
    expect(body.Fault.Error[0].Detail).toContain("ORDERBY");
  });
});
