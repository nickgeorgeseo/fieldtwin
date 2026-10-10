import { describe, expect, it } from "vitest";
import { setup } from "./helpers.ts";

/**
 * Fields as QuickBooks reads them, and the rules that keep the books consistent: text fields take text (a number is
 * read as its digits), invoice numbers keep counting, and a paid invoice stays with the customer who paid it.
 */

type Harness = ReturnType<typeof setup>;
const sale = (Amount: number) => ({ DetailType: "SalesItemLineDetail", Amount, SalesItemLineDetail: { ItemRef: { value: "1" } } });
const faultOf = async (response: Response) => (await response.json()).Fault?.Error[0];

async function invoice(harness: Harness, fields: object = {}) {
  return (await (await harness.qboPost("/invoice", { CustomerRef: { value: "1" }, Line: [sale(40)], ...fields })).json()).Invoice;
}

describe("QuickBooks twin: text fields", () => {
  it("refuses an object where text belongs (2010), naming the field", async () => {
    expect(await faultOf(await setup().qboPost("/customer", { DisplayName: { first: "Ada" } }))).toMatchObject({
      code: "2010",
      element: "DisplayName",
    });
    expect(
      await faultOf(await setup().qboPost("/invoice", { CustomerRef: { value: "1" }, Line: [sale(40)], PrivateNote: ["a"] })),
    ).toMatchObject({
      code: "2010",
      element: "PrivateNote",
    });
  });

  it("reads a payment's PaymentRefNum and PrivateNote as text, as an invoice's, refusing an object (2010)", async () => {
    const harness = setup();
    const payment = (fields: object) => harness.qboPost("/payment", { CustomerRef: { value: "1" }, TotalAmt: 5, ...fields });
    expect(await faultOf(await payment({ PrivateNote: { text: "x" } }))).toMatchObject({ code: "2010", element: "PrivateNote" });
    expect((await (await payment({ PaymentRefNum: 1234 })).json()).Payment.PaymentRefNum).toBe("1234");
  });

  it("reads a number sent as a DocNumber as its digits, and still checks its length (2050)", async () => {
    const harness = setup();
    expect((await invoice(harness, { DocNumber: 4471 })).DocNumber).toBe("4471");
    expect(
      await faultOf(await harness.qboPost("/invoice", { CustomerRef: { value: "1" }, Line: [sale(40)], DocNumber: 1.2345678901234568e22 })),
    ).toMatchObject({
      code: "2050",
    });
  });
});

describe("QuickBooks twin: invoice numbers", () => {
  it("refuses a PrivateNote longer than its documented 4,000 characters on an invoice or a payment (2050)", async () => {
    const harness = setup();
    const note = "n".repeat(4001);
    const onInvoice = await harness.qboPost("/invoice", { CustomerRef: { value: "1" }, Line: [sale(40)], PrivateNote: note });
    expect(await faultOf(onInvoice)).toMatchObject({ code: "2050", element: "PrivateNote" });
    const onPayment = await harness.qboPost("/payment", { CustomerRef: { value: "1" }, TotalAmt: 5, PrivateNote: note });
    expect(await faultOf(onPayment)).toMatchObject({ code: "2050", element: "PrivateNote" });
    expect((await invoice(harness, { PrivateNote: "n".repeat(4000) })).PrivateNote).toHaveLength(4000);
  });

  it("keeps numbering from the last ordinary number, whatever odd DocNumbers have been sent", async () => {
    const harness = setup();
    const first = await invoice(harness);
    await invoice(harness, { DocNumber: "999999999999999999999" }); // 21 digits: allowed, but no number to count from
    await invoice(harness, { DocNumber: "JB-77" });
    const next = await invoice(harness);
    expect(Number(next.DocNumber)).toBe(Number(first.DocNumber) + 1);
  });
});

describe("QuickBooks twin: paid invoices and their customers", () => {
  async function paidInvoice(harness: Harness) {
    const created = await invoice(harness);
    await harness.qboPost("/payment", {
      CustomerRef: { value: "1" },
      TotalAmt: 15,
      Line: [{ Amount: 15, LinkedTxn: [{ TxnId: created.Id, TxnType: "Invoice" }] }],
    });
    return (await (await harness.qboGet(`/invoice/${created.Id}`)).json()).Invoice;
  }

  it("won't move an invoice with payments applied to another customer (6000)", async () => {
    const harness = setup();
    const paid = await paidInvoice(harness);
    const response = await harness.qboPost("/invoice", {
      Id: paid.Id,
      SyncToken: paid.SyncToken,
      sparse: true,
      CustomerRef: { value: "2" },
    });
    expect(await faultOf(response)).toMatchObject({ code: "6000" });
  });

  it("still updates an invoice whose customer has since been made inactive", async () => {
    const harness = setup();
    const created = await invoice(harness);
    const { Customer } = await (await harness.qboGet("/customer/1")).json();
    await harness.qboPost("/customer", { Id: "1", SyncToken: Customer.SyncToken, sparse: true, Active: false });
    const response = await harness.qboPost("/invoice", {
      Id: created.Id,
      SyncToken: created.SyncToken,
      sparse: true,
      PrivateNote: "Still ours",
    });
    expect(response.status).toBe(200);
  });

  it("says a customer is inactive when a new invoice names one", async () => {
    const harness = setup();
    const { Customer } = await (await harness.qboGet("/customer/1")).json();
    await harness.qboPost("/customer", { Id: "1", SyncToken: Customer.SyncToken, sparse: true, Active: false });
    const error = await faultOf(await harness.qboPost("/invoice", { CustomerRef: { value: "1" }, Line: [sale(40)] }));
    expect(error).toMatchObject({ code: "2500", element: "CustomerRef" });
    expect(error.Detail).toContain("inactive");
  });
});

describe("QuickBooks twin: today's date", () => {
  it("defaults TxnDate to the business's date, not UTC's: 8 p.m. in Texas is still the 13th", async () => {
    const harness = setup(); // Rowntree Electric, in Oak Hollow, Texas: UTC-5
    harness.twin.clock.advance(14 * 3_600_000); // 2026-07-14T01:00Z
    expect((await invoice(harness)).TxnDate).toBe("2026-07-13");
    const payment = await (await harness.qboPost("/payment", { CustomerRef: { value: "1" }, TotalAmt: 5 })).json();
    expect(payment.Payment.TxnDate).toBe("2026-07-13");
  });
});
