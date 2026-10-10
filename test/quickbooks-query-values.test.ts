import { describe, expect, it } from "vitest";
import { setup } from "./helpers.ts";

/**
 * How query values compare, by the kind of property: https://developer.intuit.com/app/developer/qbo/docs/learn/explore-the-quickbooks-online-api/data-queries
 * DocNumber and names are text, however many digits they hold; Ids are numbers; Active is true or false.
 */
type Harness = ReturnType<typeof setup>;

const query = async (harness: Harness, statement: string) => {
  const response = await harness.qboGet(`/query?query=${encodeURIComponent(statement)}`);
  return { status: response.status, body: await response.json() };
};
const invoiceNumbered = (harness: Harness, DocNumber: string) =>
  harness.qboPost("/invoice", {
    CustomerRef: { value: "1" },
    DocNumber,
    Line: [{ DetailType: "SalesItemLineDetail", Amount: 10, SalesItemLineDetail: { ItemRef: { value: "1" } } }],
  });

describe("QuickBooks query values", () => {
  it("sort DocNumbers as text, in the same order whatever order the invoices were made in", async () => {
    const orders: string[][] = [];
    for (const made of [
      ["90", "100", "1st"],
      ["100", "1st", "90"],
    ]) {
      const harness = setup();
      for (const number of made) await invoiceNumbered(harness, number);
      const { body } = await query(harness, "SELECT * FROM Invoice WHERE DocNumber IN ('90', '100', '1st') ORDERBY DocNumber");
      orders.push(body.QueryResponse.Invoice.map((invoice: { DocNumber: string }) => invoice.DocNumber));
    }
    expect(orders).toEqual([
      ["100", "1st", "90"],
      ["100", "1st", "90"],
    ]);
  });

  it("match a long numeric DocNumber digit for digit, not as a rounded number", async () => {
    const harness = setup();
    await invoiceNumbered(harness, "123456789012345678901");
    const near = await query(harness, "SELECT COUNT(*) FROM Invoice WHERE DocNumber = '123456789012345678900'");
    const exact = await query(harness, "SELECT COUNT(*) FROM Invoice WHERE DocNumber = '123456789012345678901'");
    expect([near.body.QueryResponse.totalCount, exact.body.QueryResponse.totalCount]).toEqual([0, 1]);
  });

  it("sort Ids as numbers", async () => {
    const { body } = await query(setup(), "SELECT * FROM Customer WHERE Id IN ('2', '10', '9') ORDERBY Id");
    expect(body.QueryResponse.Customer.map((customer: { Id: string }) => customer.Id)).toEqual(["2", "9", "10"]);
  });

  it("take a negative number only in quotes, as the docs write every value: TotalAmt > '-1', not TotalAmt > -1", async () => {
    const harness = setup();
    const unquoted = await query(harness, "SELECT COUNT(*) FROM Invoice WHERE TotalAmt > -1");
    expect(unquoted.status).toBe(400);
    expect(unquoted.body.Fault.Error[0].code).toBe("4000");
    const quoted = await query(harness, "SELECT COUNT(*) FROM Invoice WHERE TotalAmt > '-1'");
    expect(quoted.body.QueryResponse.totalCount).toBeGreaterThan(0);
  });

  it("match no text against true or false", async () => {
    const { body } = await query(setup(), "SELECT COUNT(*) FROM Customer WHERE DisplayName = false");
    expect(body.QueryResponse.totalCount).toBe(0);
  });

  it("refuse an Active that is neither true nor false, instead of reading it as false", async () => {
    const { status, body } = await query(setup(), "SELECT * FROM Customer WHERE Active = 'yes'");
    expect(status).toBe(400);
    expect(body.Fault.Error[0]).toMatchObject({ code: "4001" });
    expect(body.Fault.Error[0].Detail).toContain("true or false");
  });
});
