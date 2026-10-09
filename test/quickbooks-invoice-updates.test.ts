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

describe("QuickBooks twin: updating invoices", () => {
  async function createdInvoice(harness: ReturnType<typeof setup>) {
    const response = await harness.qboPost("/invoice", {
      CustomerRef: { value: "2" },
      Line: [salesLine("1", 1, 90), salesLine("6", 3, 30)],
      PrivateNote: "Gate code 1234",
      CustomerMemo: { value: "Thanks for your business" },
    });
    return (await response.json()).Invoice;
  }

  it("applies a sparse update to only the fields you send", async () => {
    const harness = setup();
    const original = await createdInvoice(harness);
    harness.twin.clock.advance(60_000);

    const { Invoice } = await (
      await harness.qboPost("/invoice", { Id: original.Id, SyncToken: "0", sparse: true, PrivateNote: "Dog in the yard" })
    ).json();
    expect(Invoice).toMatchObject({
      SyncToken: "1",
      PrivateNote: "Dog in the yard",
      CustomerMemo: { value: "Thanks for your business" },
      DocNumber: original.DocNumber,
      TotalAmt: 180,
      Balance: 180,
      MetaData: { CreateTime: original.MetaData.CreateTime, LastUpdatedTime: "2026-07-13T11:01:00.000Z" },
    });
    expect(Invoice.Line).toEqual(original.Line);
  });

  it("clears every writable field a full update leaves out, DocNumber included, as documented", async () => {
    const harness = setup();
    const original = await createdInvoice(harness);
    const { Invoice } = await (
      await harness.qboPost("/invoice", { Id: original.Id, SyncToken: "0", CustomerRef: original.CustomerRef, Line: original.Line })
    ).json();
    expect(Invoice.SyncToken).toBe("1");
    expect(Invoice.PrivateNote).toBeUndefined();
    expect(Invoice.CustomerMemo).toBeUndefined();
    expect(Invoice.DocNumber).toBeUndefined();
  });

  it("recomputes TotalAmt when lines change, keeping the Ids of lines sent back and ignoring the echoed subtotal", async () => {
    const harness = setup();
    const original = await createdInvoice(harness);
    const [first, second, subtotal] = original.Line;
    const lines = [
      first,
      { ...second, Amount: 60, SalesItemLineDetail: { ...second.SalesItemLineDetail, Qty: 2 } },
      salesLine("7", 1, 45),
      subtotal, // what a client that read the invoice would send back
    ];
    const { Invoice } = await (await harness.qboPost("/invoice", { Id: original.Id, SyncToken: "0", sparse: true, Line: lines })).json();
    expect(Invoice.Line.map((line: { Id?: string }) => line.Id)).toEqual(["1", "2", "3", undefined]);
    expect(Invoice.TotalAmt).toBe(195);
    expect(Invoice.Balance).toBe(195);
    expect(Invoice.Line.at(-1)).toEqual({ Amount: 195, DetailType: "SubTotalLineDetail", SubTotalLineDetail: {} });
  });

  it("rejects an update that sends an old SyncToken (5010), changing nothing", async () => {
    const harness = setup();
    const original = await createdInvoice(harness);
    await harness.qboPost("/invoice", { Id: original.Id, SyncToken: "0", sparse: true, PrivateNote: "first" });
    const stale = await harness.qboPost("/invoice", { Id: original.Id, SyncToken: "0", sparse: true, PrivateNote: "second" });
    expect((await errorOf(stale)).code).toBe("5010");
    const { Invoice } = await (await harness.qboGet(`/invoice/${original.Id}`)).json();
    expect(Invoice).toMatchObject({ SyncToken: "1", PrivateNote: "first" });
  });

  it("requires the SyncToken (2020) and an Id that exists (610)", async () => {
    const harness = setup();
    const original = await createdInvoice(harness);
    expect(await errorOf(await harness.qboPost("/invoice", { Id: original.Id, sparse: true, PrivateNote: "x" }))).toMatchObject({
      code: "2020",
      element: "SyncToken",
    });
    expect((await errorOf(await harness.qboPost("/invoice", { Id: "999", SyncToken: "0", sparse: true }))).code).toBe("610");
  });
});
