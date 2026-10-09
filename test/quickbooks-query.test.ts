import { describe, expect, it } from "vitest";
import { parseQboQuery } from "../src/vendors/quickbooks/query-language.ts";
import { setup } from "./helpers.ts";

/** Query language: https://developer.intuit.com/app/developer/qbo/docs/learn/explore-the-quickbooks-online-api/data-queries */

const query = async (harness: ReturnType<typeof setup>, statement: string) => {
  const response = await harness.qboGet(`/query?query=${encodeURIComponent(statement)}`);
  return { status: response.status, body: await response.json() };
};

describe("QuickBooks query language: parsing", () => {
  it("reads the documented statement shape", () => {
    expect(parseQboQuery("SELECT * FROM Customer WHERE GivenName = 'greg' STARTPOSITION 10 MAXRESULTS 5")).toEqual({
      select: "*",
      entity: "Customer",
      where: { property: "GivenName", operator: "=", values: ["greg"] },
      startPosition: 10,
      maxResults: 5,
    });
  });

  it("treats reserved words case-insensitively, as documented", () => {
    expect(parseQboQuery("select * from cUstomer where givenname = 'Greg' Startposition 10")).toMatchObject({
      entity: "cUstomer",
      where: { property: "givenname", values: ["Greg"] },
      startPosition: 10,
    });
  });

  it("unescapes backslash-escaped apostrophes in values", () => {
    expect(parseQboQuery("SELECT * FROM Customer WHERE CompanyName = 'Adam\\'s Candy Shop'")).toMatchObject({
      where: { values: ["Adam's Candy Shop"] },
    });
  });

  it("defaults to the first 100 results and caps a page at 1,000", () => {
    expect(parseQboQuery("select * from Customer")).toMatchObject({ startPosition: 1, maxResults: 100 });
    expect(parseQboQuery("select * from Customer maxresults 5000")).toMatchObject({ maxResults: 1000 });
  });

  it("tells syntax errors apart from features the twin doesn't support yet", () => {
    expect(parseQboQuery("selec * frm Customer")).toMatchObject({ kind: "syntax" });
    expect(parseQboQuery("select * from Customer where GivenName = 'unterminated")).toMatchObject({ kind: "syntax" });
    for (const unsupported of [
      "select * from Customer where GivenName LIKE 'K%'",
      "select * from Customer where GivenName = 'a' AND FamilyName = 'b'",
      "select * from Customer orderby FamilyName",
    ]) {
      expect(parseQboQuery(unsupported)).toMatchObject({ kind: "unsupported" });
    }
  });
});

describe("QuickBooks twin: GET /query", () => {
  it("pages through customers with STARTPOSITION and MAXRESULTS", async () => {
    const { body } = await query(setup(), "select * from Customer startposition 21 maxresults 10");
    expect(body.QueryResponse.Customer).toHaveLength(5); // 25 seeded customers, so positions 21-25
    expect(body.QueryResponse).toMatchObject({ startPosition: 21, maxResults: 5 });
  });

  it("matches values without regard to case, as documented", async () => {
    const harness = setup();
    const { Customer } = await (await harness.qboGet("/customer/1")).json();
    const { body } = await query(harness, `select * from Customer where DisplayName = '${Customer.DisplayName.toUpperCase()}'`);
    expect(body.QueryResponse.Customer.map((c: { Id: string }) => c.Id)).toEqual(["1"]);
  });

  it("finds a name with an apostrophe when the query escapes it", async () => {
    const harness = setup();
    await harness.qboPost("/customer", { DisplayName: "Pat O'Rourke" });
    const { body } = await query(harness, "select * from Customer where DisplayName = 'Pat O\\'Rourke'");
    expect(body.QueryResponse.Customer[0].DisplayName).toBe("Pat O'Rourke");
  });

  it("answers an empty QueryResponse when nothing matches", async () => {
    const { body } = await query(setup(), "select * from Customer where DisplayName = 'Nobody Here'");
    expect(body.QueryResponse).toEqual({});
  });

  it("answers a property the entity doesn't have with 4001", async () => {
    const { status, body } = await query(setup(), "select * from Customer where ShoeSize = '9'");
    expect(status).toBe(400);
    expect(body.Fault.Error[0]).toMatchObject({ code: "4001", Message: "The query is invalid" });
  });

  it("answers features the twin doesn't model yet with 500 Unsupported operation, naming the feature", async () => {
    const { body } = await query(setup(), "select * from Customer where GivenName LIKE 'K%'");
    expect(body.Fault.Error[0]).toMatchObject({ code: "500", Message: "Unsupported operation" });
    expect(body.Fault.Error[0].Detail).toContain("LIKE");
  });
});

describe("QuickBooks twin: querying each entity", () => {
  const sale = (Amount: number) => ({ DetailType: "SalesItemLineDetail", Amount, SalesItemLineDetail: { ItemRef: { value: "1" } } });

  it("queries Item, as in the Item reference's sample query", async () => {
    const { body } = await query(setup(), "select * from Item maxresults 2");
    expect(body.QueryResponse).toMatchObject({ startPosition: 1, maxResults: 2 });
    expect(body.QueryResponse.Item.map((item: { Id: string }) => item.Id)).toEqual(["1", "2"]);
  });

  it("queries Invoice, filtering on DocNumber", async () => {
    const harness = setup();
    await harness.qboPost("/invoice", { CustomerRef: { value: "1" }, Line: [sale(50)], DocNumber: "JB-7" });
    await harness.qboPost("/invoice", { CustomerRef: { value: "1" }, Line: [sale(75)], DocNumber: "JB-8" });
    const { body } = await query(harness, "select * from Invoice where DocNumber = 'jb-8'");
    expect(body.QueryResponse.Invoice).toHaveLength(1);
    expect(body.QueryResponse.Invoice[0]).toMatchObject({ DocNumber: "JB-8", TotalAmt: 75, domain: "QBO" });
  });

  it("queries Payment, filtering on a number", async () => {
    const harness = setup();
    await harness.qboPost("/payment", { CustomerRef: { value: "1" }, TotalAmt: 40 });
    await harness.qboPost("/payment", { CustomerRef: { value: "2" }, TotalAmt: 60 });
    const { body } = await query(harness, "select * from Payment where TotalAmt = '60'");
    expect(body.QueryResponse.Payment.map((payment: { TotalAmt: number }) => payment.TotalAmt)).toEqual([60]);
  });
});

describe("QuickBooks query clause: WHERE Id = and IN", () => {
  it("parses IN lists", () => {
    expect(parseQboQuery("SELECT * FROM Invoice WHERE id in ('64523', '18761', '35767')")).toMatchObject({
      where: { property: "id", operator: "in", values: ["64523", "18761", "35767"] },
    });
  });

  it("finds one record by Id, and several with IN", async () => {
    const harness = setup();
    const one = await query(harness, "select * from Customer where Id = '7'");
    expect(one.body.QueryResponse.Customer.map((c: { Id: string }) => c.Id)).toEqual(["7"]);

    const several = await query(harness, "select * from Customer where Id in ('2', '5', '999')");
    expect(several.body.QueryResponse.Customer.map((c: { Id: string }) => c.Id)).toEqual(["2", "5"]);
  });

  it("supports IN on other properties, like the documented Active IN (true, false)", async () => {
    const { body } = await query(setup(), "select * from Customer where Active IN (true, false) maxresults 1000");
    expect(body.QueryResponse.Customer).toHaveLength(25);
  });

  it("rejects range operators on Id, which QuickBooks doesn't allow there", () => {
    expect(parseQboQuery("select * from Customer where Id > '3'")).toMatchObject({ kind: "unsupported" });
  });
});

describe("QuickBooks query clause: WHERE on a reference", () => {
  const sale = (Amount: number) => ({ DetailType: "SalesItemLineDetail", Amount, SalesItemLineDetail: { ItemRef: { value: "1" } } });

  it("finds all invoices for a customer, as in the documented WHERE CustomerRef = '123'", async () => {
    const harness = setup();
    for (const [customer, amount] of [
      ["3", 10],
      ["4", 20],
      ["3", 30],
    ] as const) {
      await harness.qboPost("/invoice", { CustomerRef: { value: customer }, Line: [sale(amount)] });
    }
    const { body } = await query(harness, "SELECT * FROM Invoice WHERE CustomerRef = '3'");
    expect(body.QueryResponse.Invoice.map((invoice: { TotalAmt: number }) => invoice.TotalAmt)).toEqual([10, 30]);
  });

  it("compares a reference by Id, not by name", async () => {
    const harness = setup();
    await harness.qboPost("/payment", { CustomerRef: { value: "3" }, TotalAmt: 15 });
    const { Customer } = await (await harness.qboGet("/customer/3")).json();
    const byName = await query(harness, `select * from Payment where CustomerRef = '${Customer.DisplayName}'`);
    expect(byName.body.QueryResponse).toEqual({});
    const byId = await query(harness, "select * from Payment where CustomerRef IN ('3', '4')");
    expect(byId.body.QueryResponse.Payment).toHaveLength(1);
  });
});

describe("QuickBooks query clause: COUNT(*)", () => {
  it("parses the documented statement, missing space and all", () => {
    expect(parseQboQuery("SELECT COUNT(*)FROM Customer")).toMatchObject({ select: "count", entity: "Customer" });
  });

  it("answers totalCount and no records, ignoring pagination", async () => {
    const { body } = await query(setup(), "SELECT COUNT(*) FROM Customer MAXRESULTS 5");
    expect(body.QueryResponse).toEqual({ totalCount: 25 });
  });

  it("counts only what the WHERE clause matches, including nothing", async () => {
    const harness = setup();
    expect((await query(harness, "select count(*) from Customer where Id in ('1', '2', '3')")).body.QueryResponse).toEqual({
      totalCount: 3,
    });
    expect((await query(harness, "select count(*) from Invoice where DocNumber = 'no-such-number'")).body.QueryResponse).toEqual({
      totalCount: 0,
    });
  });
});

describe("QuickBooks twin: POST /query", () => {
  it("runs a query sent as the request body, for statements too long for a URL", async () => {
    const { app } = setup();
    const response = await app.request("/v3/company/9341000000000001/query", {
      method: "POST",
      headers: { Authorization: "Bearer t", "Content-Type": "application/text" },
      body: "SELECT COUNT(*) FROM Customer WHERE Active = true",
    });
    expect(response.status).toBe(200);
    expect((await response.json()).QueryResponse).toEqual({ totalCount: 25 });
  });
});
