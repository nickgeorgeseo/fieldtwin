import { describe, expect, it } from "vitest";
import { multiplyMoney, sumMoney, toCents } from "../src/core/money.ts";
import { setup } from "./helpers.ts";

/**
 * Amounts: JSON numbers, or numeric strings (SDKs such as python-quickbooks send decimals as strings), in whole
 * cents. Error codes: https://developer.intuit.com/app/developer/qbo/docs/develop/troubleshooting/error-codes
 */

const line = (Amount: unknown, detail: object = {}) => ({
  DetailType: "SalesItemLineDetail",
  Amount,
  SalesItemLineDetail: { ItemRef: { value: "1" }, ...detail },
});
const invoiceWith = (lines: object[]) => ({ CustomerRef: { value: "1" }, Line: lines });
const faultOf = async (response: Response) => (await response.json()).Fault?.Error[0];

describe("QuickBooks twin: amounts", () => {
  it("accepts amounts, quantities, and prices sent as numeric strings, as some SDKs send them", async () => {
    const harness = setup();
    const invoice = await harness.qboPost("/invoice", invoiceWith([line("93.00", { Qty: "2", UnitPrice: "46.50" })]));
    expect(invoice.status).toBe(200);
    const { Invoice } = await invoice.json();
    expect(Invoice).toMatchObject({ TotalAmt: 93, Balance: 93 });
    expect(Invoice.Line[0]).toMatchObject({ Amount: 93, SalesItemLineDetail: { Qty: 2, UnitPrice: 46.5 } });

    const payment = await harness.qboPost("/payment", { CustomerRef: { value: "1" }, TotalAmt: "10.50" });
    expect(payment.status).toBe(200);
    expect((await payment.json()).Payment).toMatchObject({ TotalAmt: 10.5, UnappliedAmt: 10.5 });
  });

  it("refuses an amount in fractions of a cent (2140), rather than storing it and adding up in rounded cents", async () => {
    const harness = setup();
    expect(await faultOf(await harness.qboPost("/invoice", invoiceWith([line(0.005)])))).toMatchObject({
      code: "2140",
      element: "Line.Amount",
    });
    expect(await faultOf(await harness.qboPost("/payment", { CustomerRef: { value: "1" }, TotalAmt: 1.005 }))).toMatchObject({
      code: "2140",
      element: "TotalAmt",
    });
  });

  it.each([
    ["too big to add up", 1e307],
    ["text that isn't a number", "ninety"],
    ["not a number at all", { value: 5 }],
  ])("refuses an amount that is %s (2140), naming the field", async (_label, Amount) => {
    expect(await faultOf(await setup().qboPost("/invoice", invoiceWith([line(Amount)])))).toMatchObject({
      code: "2140",
      element: "Line.Amount",
    });
  });

  it("refuses a quantity that isn't a number (2160)", async () => {
    const response = await setup().qboPost("/invoice", invoiceWith([line(10, { Qty: "a few", UnitPrice: 5 })]));
    expect(await faultOf(response)).toMatchObject({ code: "2160", element: "Line.SalesItemLineDetail.Qty" });
  });

  it("checks Amount against Qty × UnitPrice to the cent, rounding half a cent up: 2.5 × 33.33 is 83.33", async () => {
    const harness = setup();
    expect((await harness.qboPost("/invoice", invoiceWith([line(83.33, { Qty: 2.5, UnitPrice: 33.33 })]))).status).toBe(200);
    expect(await faultOf(await harness.qboPost("/invoice", invoiceWith([line(83.32, { Qty: 2.5, UnitPrice: 33.33 })])))).toMatchObject({
      code: "6070",
    });
  });
});

describe("money arithmetic", () => {
  it("rounds half a cent away from zero, whatever floating point does to it", () => {
    expect([toCents(1.005), toCents(10.005), toCents(-1.005)]).toEqual([101, 1001, -101]);
    expect(multiplyMoney(2.5, 33.33)).toBe(83.33);
    expect(sumMoney([0.1, 0.2])).toBe(0.3);
  });

  it("multiplies by an exact unit price, even one finer than a cent", () => {
    expect(multiplyMoney(400, 0.0125)).toBe(5);
  });
});
