import { describe, expect, it } from "vitest";
import { setup } from "./helpers.ts";

/** Invoice: https://developer.intuit.com/app/developer/qbo/docs/api/accounting/all-entities/invoice */

const salesLine = (itemId: string, Qty: number, UnitPrice: number, extra: Record<string, unknown> = {}) => ({
  DetailType: "SalesItemLineDetail",
  Amount: Math.round(Qty * UnitPrice * 100) / 100,
  SalesItemLineDetail: { ItemRef: { value: itemId }, Qty, UnitPrice },
  ...extra,
});

const errorOf = async (response: Response) => (await response.json()).Fault.Error[0];

describe("QuickBooks twin: creating and reading invoices", () => {
  it("creates an invoice from item lines and computes TotalAmt and Balance the way QuickBooks does", async () => {
    const { qboGet, qboPost } = setup();
    const { Customer } = await (await qboGet("/customer/4")).json();
    const { Item: labor } = await (await qboGet("/item/2")).json();

    const response = await qboPost("/invoice", {
      CustomerRef: { value: "4" },
      Line: [salesLine("2", 1.5, 120), salesLine("6", 2, 27.5, { Description: "Two of them" })],
    });
    expect(response.status).toBe(200);
    const { Invoice } = await response.json();

    expect(Invoice).toMatchObject({
      Id: expect.stringMatching(/^\d+$/),
      SyncToken: "0",
      DocNumber: "1001",
      TxnDate: "2026-07-13",
      DueDate: "2026-07-13",
      CustomerRef: { value: "4", name: Customer.DisplayName },
      BillAddr: Customer.BillAddr,
      TotalAmt: 235,
      Balance: 235,
      domain: "QBO",
      sparse: false,
    });
    expect(Invoice.Line).toEqual([
      {
        Id: "1",
        LineNum: 1,
        Amount: 180,
        DetailType: "SalesItemLineDetail",
        SalesItemLineDetail: { ItemRef: { value: "2", name: labor.Name }, Qty: 1.5, UnitPrice: 120 },
      },
      {
        Id: "2",
        LineNum: 2,
        Description: "Two of them",
        Amount: 55,
        DetailType: "SalesItemLineDetail",
        SalesItemLineDetail: { ItemRef: { value: "6", name: expect.any(String) }, Qty: 2, UnitPrice: 27.5 },
      },
      // QuickBooks appends a subtotal line to every sales form it returns.
      { Amount: 235, DetailType: "SubTotalLineDetail", SubTotalLineDetail: {} },
    ]);
  });

  it("reads an invoice back by Id", async () => {
    const { qboGet, qboPost } = setup();
    const { Invoice: created } = await (await qboPost("/invoice", { CustomerRef: { value: "1" }, Line: [salesLine("1", 1, 99)] })).json();
    const { Invoice: read } = await (await qboGet(`/invoice/${created.Id}`)).json();
    expect(read).toEqual(created);
    expect((await qboGet("/invoice/999")).status).toBe(400);
  });

  it("keeps a DocNumber you supply and numbers the rest after the last one", async () => {
    const { qboPost } = setup();
    const create = async (extra: Record<string, unknown>) =>
      (await (await qboPost("/invoice", { CustomerRef: { value: "1" }, Line: [salesLine("1", 1, 50)], ...extra })).json()).Invoice;
    expect((await create({})).DocNumber).toBe("1001");
    expect((await create({ DocNumber: "JB-1042" })).DocNumber).toBe("JB-1042");
    expect((await create({ DocNumber: "2000" })).DocNumber).toBe("2000");
    expect((await create({})).DocNumber).toBe("2001");
  });

  it("uses the TxnDate and DueDate you send", async () => {
    const { qboPost } = setup();
    const { Invoice } = await (
      await qboPost("/invoice", {
        CustomerRef: { value: "1" },
        Line: [salesLine("1", 1, 50)],
        TxnDate: "2026-07-01",
        DueDate: "2026-07-31",
      })
    ).json();
    expect(Invoice).toMatchObject({ TxnDate: "2026-07-01", DueDate: "2026-07-31" });
  });

  it("rejects a line whose Amount is not Qty times UnitPrice (6070)", async () => {
    const { qboPost } = setup();
    const line = { ...salesLine("1", 2, 50), Amount: 99 };
    const error = await errorOf(await qboPost("/invoice", { CustomerRef: { value: "1" }, Line: [line] }));
    expect(error).toMatchObject({ code: "6070", Message: "Amount calculation incorrect in the request" });
    expect(error.Detail).toContain("99");
  });

  it("rejects negative line amounts (2290)", async () => {
    const { qboPost } = setup();
    const line = { DetailType: "SalesItemLineDetail", Amount: -10, SalesItemLineDetail: { ItemRef: { value: "1" } } };
    expect(await errorOf(await qboPost("/invoice", { CustomerRef: { value: "1" }, Line: [line] }))).toMatchObject({ code: "2290" });
  });

  it("rejects references to customers or items that do not exist (2500)", async () => {
    const { qboPost } = setup();
    const badCustomer = await errorOf(await qboPost("/invoice", { CustomerRef: { value: "999" }, Line: [salesLine("1", 1, 5)] }));
    expect(badCustomer).toMatchObject({ code: "2500", Message: "Invalid Reference Id", element: "CustomerRef" });
    const badItem = await errorOf(await qboPost("/invoice", { CustomerRef: { value: "1" }, Line: [salesLine("999", 1, 5)] }));
    expect(badItem).toMatchObject({ code: "2500", element: "Line.SalesItemLineDetail.ItemRef" });
  });

  it("requires a customer, at least one line, and an Amount on every line (2020)", async () => {
    const { qboPost } = setup();
    expect(await errorOf(await qboPost("/invoice", { Line: [salesLine("1", 1, 5)] }))).toMatchObject({
      code: "2020",
      element: "CustomerRef",
    });
    expect(await errorOf(await qboPost("/invoice", { CustomerRef: { value: "1" }, Line: [] }))).toMatchObject({
      code: "2020",
      element: "Line",
    });
    const noAmount = { DetailType: "SalesItemLineDetail", SalesItemLineDetail: { ItemRef: { value: "1" } } };
    expect(await errorOf(await qboPost("/invoice", { CustomerRef: { value: "1" }, Line: [noAmount] }))).toMatchObject({
      code: "2020",
      element: "Line.Amount",
    });
  });

  it("rejects a DocNumber longer than 21 characters (2050)", async () => {
    const { qboPost } = setup();
    const error = await errorOf(
      await qboPost("/invoice", { CustomerRef: { value: "1" }, Line: [salesLine("1", 1, 5)], DocNumber: "X".repeat(22) }),
    );
    expect(error).toMatchObject({ code: "2050", element: "DocNumber", Detail: "Min: 0, Max: 21, Supplied length: 22" });
  });

  it("says clearly which line types it does not model yet", async () => {
    const { qboPost } = setup();
    const discount = { DetailType: "DiscountLineDetail", Amount: 5, DiscountLineDetail: { PercentBased: false } };
    const error = await errorOf(await qboPost("/invoice", { CustomerRef: { value: "1" }, Line: [salesLine("1", 1, 50), discount] }));
    expect(error.code).toBe("500");
    expect(error.Detail).toContain("DiscountLineDetail");
  });

  it("records the invoice in the event log, described in one line", async () => {
    const { twin, qboPost } = setup();
    await qboPost("/invoice", { CustomerRef: { value: "1" }, Line: [salesLine("1", 1, 50)] });
    const event = twin.log.all().at(-1)!;
    expect(event.type).toBe("InvoiceCreated");
    expect(twin.vendor("quickbooks").describeEvent(event)).toMatch(
      /^InvoiceCreated Id=\d+ DocNumber=1001 ".+" TotalAmt=50\.00 Balance=50\.00$/,
    );
  });
});
