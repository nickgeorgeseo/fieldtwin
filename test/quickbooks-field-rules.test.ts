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

describe("QuickBooks twin: long numbers in text fields", () => {
  // Built by hand: JSON.stringify would write these numbers the way JavaScript reads them, digits lost.
  const raw = (harness: Harness, path: string, json: string) =>
    harness.app.request(`/v3/company/9341000000000001${path}`, {
      method: "POST",
      headers: { Authorization: "Bearer t", "Content-Type": "application/json" },
      body: json,
    });
  const line = JSON.stringify(sale(40));

  it("keeps every digit of a number too long for JavaScript to hold exactly", async () => {
    const harness = setup();
    const invoiceBody = `{"CustomerRef": {"value": "1"}, "Line": [${line}], "DocNumber": 12345678901234567890}`;
    expect((await (await raw(harness, "/invoice", invoiceBody)).json()).Invoice.DocNumber).toBe("12345678901234567890");
    const paymentBody = '{"CustomerRef": {"value": "1"}, "TotalAmt": 5, "PaymentRefNum": 12345678901234567890}';
    expect((await (await raw(harness, "/payment", paymentBody)).json()).Payment.PaymentRefNum).toBe("12345678901234567890");
  });

  it("counts a 22-digit DocNumber sent as a number by its 22 digits, past the 21 allowed (2050)", async () => {
    const response = await raw(
      setup(),
      "/invoice",
      `{"CustomerRef": {"value": "1"}, "Line": [${line}], "DocNumber": 1000000000000000000000}`,
    );
    expect(await faultOf(response)).toMatchObject({ code: "2050", element: "DocNumber" });
  });
});

describe("QuickBooks twin: a customer's Active", () => {
  const everyone = (harness: Harness) =>
    harness.qboGet(`/query?query=${encodeURIComponent("select * from Customer where Active IN (true, false)")}`);

  it.each([0, "yes", "false", { value: true }])(
    "refuses an Active of %j on a create or an update (2010), naming Active",
    async (Active) => {
      const harness = setup();
      expect(await faultOf(await harness.qboPost("/customer", { DisplayName: "Ada Maybe", Active }))).toMatchObject({
        code: "2010",
        element: "Active",
      });
      const update = await harness.qboPost("/customer", { Id: "1", SyncToken: "0", sparse: true, Active });
      expect(await faultOf(update)).toMatchObject({ code: "2010", element: "Active" });
    },
  );

  it("reads an Active of null as not sent, so every customer is still active or inactive", async () => {
    const harness = setup();
    const created = (await (await harness.qboPost("/customer", { DisplayName: "Ada Null", Active: null })).json()).Customer;
    expect(created.Active).toBe(true);
    await harness.qboPost("/customer", { Id: "1", SyncToken: "0", sparse: true, Active: false });
    const updated = (await (await harness.qboPost("/customer", { Id: "1", SyncToken: "1", sparse: true, Active: null })).json()).Customer;
    expect(updated.Active).toBe(false);
    const ids = (await (await everyone(harness)).json()).QueryResponse.Customer.map((customer: { Id: string }) => customer.Id);
    expect(ids).toEqual(expect.arrayContaining(["1", created.Id]));
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

  it("keeps counting past 15 digits, so automatic numbers never repeat", async () => {
    const harness = setup();
    await invoice(harness, { DocNumber: "999999999999999" });
    const numbers = [(await invoice(harness)).DocNumber, (await invoice(harness)).DocNumber];
    expect(numbers).toEqual(["1000000000000000", "1000000000000001"]);
    await invoice(harness, { DocNumber: "99999999999999999998" }); // 20 digits, past what a JavaScript number holds exactly
    expect((await invoice(harness)).DocNumber).toBe("99999999999999999999");
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

describe("QuickBooks twin: ids and references", () => {
  // An object no JSON reader can turn into text: String() of it throws, which once answered 500 SystemFault.
  const unreadable = { toString: 1 };

  it("refuses an Id or SyncToken that isn't text or a number (2010), naming it", async () => {
    const harness = setup();
    const customer = (fields: object) => harness.qboPost("/customer", { Id: "1", SyncToken: "0", DisplayName: "X", ...fields });
    expect(await faultOf(await customer({ Id: unreadable }))).toMatchObject({ code: "2010", element: "Id" });
    expect(await faultOf(await customer({ SyncToken: unreadable }))).toMatchObject({ code: "2010", element: "SyncToken" });
    const update = { Id: ["1"], SyncToken: "0", CustomerRef: { value: "1" }, Line: [sale(40)] };
    expect(await faultOf(await harness.qboPost("/invoice", update))).toMatchObject({ code: "2010", element: "Id" });
  });

  it("answers a reference that isn't text or a number with 2500 Invalid Reference Id, naming it", async () => {
    const harness = setup();
    const invoiceWith = (fields: object) => harness.qboPost("/invoice", { CustomerRef: { value: "1" }, Line: [sale(40)], ...fields });
    expect(await faultOf(await invoiceWith({ CustomerRef: { value: unreadable } }))).toMatchObject({
      code: "2500",
      element: "CustomerRef",
    });
    const unreadableItem = { ...sale(40), SalesItemLineDetail: { ItemRef: { value: unreadable } } };
    expect(await faultOf(await invoiceWith({ Line: [unreadableItem] }))).toMatchObject({
      code: "2500",
      element: "Line.SalesItemLineDetail.ItemRef",
    });

    const payment = (fields: object) => harness.qboPost("/payment", { CustomerRef: { value: "1" }, TotalAmt: 1, ...fields });
    const applied = { Line: [{ Amount: 1, LinkedTxn: [{ TxnId: unreadable, TxnType: "Invoice" }] }] };
    expect(await faultOf(await payment({ CustomerRef: { value: unreadable } }))).toMatchObject({ code: "2500", element: "CustomerRef" });
    expect(await faultOf(await payment(applied))).toMatchObject({ code: "2500", element: "Line.LinkedTxn.TxnId" });
  });

  it("refuses an unreadable line Id, DetailType, TxnType, or TxnDate with a validation Fault, not a system fault", async () => {
    const harness = setup();
    const invoiceWith = (fields: object) => harness.qboPost("/invoice", { CustomerRef: { value: "1" }, Line: [sale(40)], ...fields });
    expect(await faultOf(await invoiceWith({ Line: [{ ...sale(40), Id: unreadable }] }))).toMatchObject({
      code: "2010",
      element: "Line.Id",
    });
    expect(await faultOf(await invoiceWith({ Line: [{ ...sale(40), DetailType: unreadable }] }))).toMatchObject({ code: "500" });
    expect(await faultOf(await invoiceWith({ TxnDate: unreadable }))).toMatchObject({ code: "2070", element: "TxnDate" });
    const payment = { CustomerRef: { value: "1" }, TotalAmt: 1, Line: [{ Amount: 1, LinkedTxn: [{ TxnId: "1", TxnType: unreadable }] }] };
    expect(await faultOf(await harness.qboPost("/payment", payment))).toMatchObject({ code: "500" });
    expect(await faultOf(await harness.qboPost("/payment", { ...payment, Line: [], TxnDate: unreadable }))).toMatchObject({ code: "2070" });
  });

  it("still reads an Id or reference sent as a number as its digits", async () => {
    const harness = setup();
    const created = await invoice(harness, { CustomerRef: { value: 2 } });
    expect(created.CustomerRef.value).toBe("2");
    const updated = await harness.qboPost("/invoice", { Id: Number(created.Id), SyncToken: 0, sparse: true, PrivateNote: "Numbers" });
    expect((await updated.json()).Invoice).toMatchObject({ Id: created.Id, SyncToken: "1", PrivateNote: "Numbers" });
  });
});
