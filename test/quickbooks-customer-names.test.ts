import { describe, expect, it } from "vitest";
import { setup } from "./helpers.ts";

/**
 * Customer names, by the Customer reference's business rules:
 * https://developer.intuit.com/app/developer/qbo/docs/api/accounting/all-entities/customer
 */

const faultOf = async (response: Response) => (await response.json()).Fault?.Error[0];

describe("QuickBooks twin: customer names", () => {
  it("keeps CompanyName, as documented, and can filter on it", async () => {
    const harness = setup();
    const created = (await (await harness.qboPost("/customer", { DisplayName: "James King", CompanyName: "King Groceries" })).json())
      .Customer;
    expect(created.CompanyName).toBe("King Groceries");
    const response = await harness.qboGet(
      `/query?query=${encodeURIComponent("select * from Customer where CompanyName = 'King Groceries'")}`,
    );
    expect((await response.json()).QueryResponse.Customer.map((customer: { Id: string }) => customer.Id)).toEqual([created.Id]);
  });

  it("refuses a CompanyName longer than 100 characters (2050)", async () => {
    expect(await faultOf(await setup().qboPost("/customer", { DisplayName: "Long Co", CompanyName: "x".repeat(101) }))).toMatchObject({
      code: "2050",
      element: "CompanyName",
    });
  });

  it("refuses a colon, tab, or newline in a name (2040), as the business rules say", async () => {
    for (const DisplayName of ["Smith: Kitchen job", "Tab\there", "Two\nlines"]) {
      expect(await faultOf(await setup().qboPost("/customer", { DisplayName }))).toMatchObject({ code: "2040", element: "DisplayName" });
    }
  });

  it("counts a name as taken whatever its case or surrounding spaces (6240)", async () => {
    const harness = setup();
    const { Customer } = await (await harness.qboGet("/customer/2")).json();
    for (const DisplayName of [Customer.DisplayName.toUpperCase(), ` ${Customer.DisplayName} `]) {
      expect(await faultOf(await harness.qboPost("/customer", { DisplayName }))).toMatchObject({ code: "6240" });
    }
  });
});

describe("QuickBooks twin: references after a rename", () => {
  it("shows a customer's current name on its invoices and payments", async () => {
    const harness = setup();
    const sale = { DetailType: "SalesItemLineDetail", Amount: 20, SalesItemLineDetail: { ItemRef: { value: "1" } } };
    const { Invoice } = await (await harness.qboPost("/invoice", { CustomerRef: { value: "4" }, Line: [sale] })).json();
    const { Payment } = await (await harness.qboPost("/payment", { CustomerRef: { value: "4" }, TotalAmt: 5 })).json();
    const { Customer } = await (await harness.qboGet("/customer/4")).json();
    await harness.qboPost("/customer", { Id: "4", SyncToken: Customer.SyncToken, sparse: true, DisplayName: "Taylor Brooks LLC" });

    expect((await (await harness.qboGet(`/invoice/${Invoice.Id}`)).json()).Invoice.CustomerRef).toEqual({
      value: "4",
      name: "Taylor Brooks LLC",
    });
    expect((await (await harness.qboGet(`/payment/${Payment.Id}`)).json()).Payment.CustomerRef).toEqual({
      value: "4",
      name: "Taylor Brooks LLC",
    });
  });
});
