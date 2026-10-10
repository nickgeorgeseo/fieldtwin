import { describe, expect, it } from "vitest";
import { setup } from "./helpers.ts";

/** Payment lines: https://developer.intuit.com/app/developer/qbo/docs/api/accounting/all-entities/payment */

const sale = (Amount: number) => ({ DetailType: "SalesItemLineDetail", Amount, SalesItemLineDetail: { ItemRef: { value: "1" } } });

async function invoiceFor(harness: ReturnType<typeof setup>, amount: number) {
  return (await (await harness.qboPost("/invoice", { CustomerRef: { value: "1" }, Line: [sale(amount)] })).json()).Invoice;
}

describe("QuickBooks twin: payment lines", () => {
  it("asks for TxnType when a LinkedTxn leaves it out (2020)", async () => {
    const harness = setup();
    const invoice = await invoiceFor(harness, 50);
    const response = await harness.qboPost("/payment", {
      CustomerRef: { value: "1" },
      TotalAmt: 50,
      Line: [{ Amount: 50, LinkedTxn: [{ TxnId: invoice.Id }] }],
    });
    expect((await response.json()).Fault.Error[0]).toMatchObject({ code: "2020", element: "Line.LinkedTxn.TxnType" });
  });

  it("refuses a line linked to several transactions, rather than applying it to the first and ignoring the rest", async () => {
    const harness = setup();
    const [first, second] = [await invoiceFor(harness, 50), await invoiceFor(harness, 30)];
    const links = [
      { TxnId: first.Id, TxnType: "Invoice" },
      { TxnId: second.Id, TxnType: "Invoice" },
    ];
    const response = await harness.qboPost("/payment", {
      CustomerRef: { value: "1" },
      TotalAmt: 80,
      Line: [{ Amount: 80, LinkedTxn: links }],
    });
    expect((await response.json()).Fault.Error[0]).toMatchObject({ code: "500", Message: "Unsupported operation" });
    expect((await (await harness.qboGet(`/invoice/${first.Id}`)).json()).Invoice.Balance).toBe(50);
  });
});
