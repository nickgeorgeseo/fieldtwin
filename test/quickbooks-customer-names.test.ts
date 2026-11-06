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

  it.each([
    ["DisplayName", 500, (value: string) => ({ DisplayName: value })],
    ["GivenName", 100, (value: string) => ({ DisplayName: "Long Given", GivenName: value })],
    ["FamilyName", 100, (value: string) => ({ DisplayName: "Long Family", FamilyName: value })],
    ["PrimaryPhone.FreeFormNumber", 30, (value: string) => ({ DisplayName: "Long Phone", PrimaryPhone: { FreeFormNumber: value } })],
  ] as const)("refuses a %s longer than its documented %i characters (2050), and takes one at the limit", async (element, max, body) => {
    const harness = setup();
    expect(await faultOf(await harness.qboPost("/customer", body("5".repeat(max + 1))))).toMatchObject({ code: "2050", element });
    expect((await harness.qboPost("/customer", body("5".repeat(max)))).status).toBe(200);
  });

  it("reads a phone number sent as a number as its digits, so its 30-character limit still holds (2050)", async () => {
    const harness = setup();
    const created = (
      await (await harness.qboPost("/customer", { DisplayName: "Ada Phone", PrimaryPhone: { FreeFormNumber: 5551234 } })).json()
    ).Customer;
    expect(created.PrimaryPhone.FreeFormNumber).toBe("5551234");
    // Written by hand: JSON.stringify would send 40 digits as 5.555555555555555e+39.
    const response = await harness.app.request("/v3/company/9341000000000001/customer", {
      method: "POST",
      headers: { Authorization: "Bearer t", "Content-Type": "application/json" },
      body: `{"DisplayName": "Ada Long Phone", "PrimaryPhone": {"FreeFormNumber": ${"5".repeat(40)}}}`,
    });
    expect(await faultOf(response)).toMatchObject({ code: "2050", element: "PrimaryPhone.FreeFormNumber" });
  });

  it("refuses an object where a phone number or email address belongs (2010), naming the field", async () => {
    for (const [fields, element] of [
      [{ PrimaryPhone: { FreeFormNumber: { digits: "555" } } }, "PrimaryPhone.FreeFormNumber"],
      [{ PrimaryEmailAddr: { Address: ["ada@example.com"] } }, "PrimaryEmailAddr.Address"],
    ] as const) {
      expect(await faultOf(await setup().qboPost("/customer", { DisplayName: "Ada Object", ...fields }))).toMatchObject({
        code: "2010",
        element,
      });
    }
  });

  it("refuses a colon, tab, or newline in a name (2040), as the business rules say", async () => {
    for (const DisplayName of ["Smith: Kitchen job", "Tab\there", "Two\nlines"]) {
      expect(await faultOf(await setup().qboPost("/customer", { DisplayName }))).toMatchObject({ code: "2040", element: "DisplayName" });
    }
  });

  it("reads a DisplayName of only spaces as the empty name it is, and asks for one (2020)", async () => {
    const harness = setup();
    expect(await faultOf(await harness.qboPost("/customer", { DisplayName: "   " }))).toMatchObject({
      code: "2020",
      element: "DisplayName",
    });
    const update = await harness.qboPost("/customer", { Id: "1", SyncToken: "0", sparse: true, DisplayName: " " });
    expect(await faultOf(update)).toMatchObject({ code: "2020", element: "DisplayName" });
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
