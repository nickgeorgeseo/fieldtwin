import { describe, expect, it } from "vitest";
import { createCheckpoint, listChanges } from "../src/control/operations.ts";
import { setup } from "./helpers.ts";

/** Payment: https://developer.intuit.com/app/developer/qbo/docs/api/accounting/all-entities/payment */

type Harness = ReturnType<typeof setup>;

async function invoiceFor(harness: Harness, customerId: string, amount: number) {
  const line = { DetailType: "SalesItemLineDetail", Amount: amount, SalesItemLineDetail: { ItemRef: { value: "1" } } };
  return (await (await harness.qboPost("/invoice", { CustomerRef: { value: customerId }, Line: [line] })).json()).Invoice;
}

const applyTo = (invoiceId: string, Amount: number) => ({ Amount, LinkedTxn: [{ TxnId: invoiceId, TxnType: "Invoice" }] });
const errorOf = async (response: Response) => (await response.json()).Fault.Error[0];

describe("QuickBooks twin: payments", () => {
  it("pays an invoice in full: its Balance drops to 0 and it links the payment", async () => {
    const harness = setup();
    const invoice = await invoiceFor(harness, "3", 235);

    const response = await harness.qboPost("/payment", { CustomerRef: { value: "3" }, TotalAmt: 235, Line: [applyTo(invoice.Id, 235)] });
    expect(response.status).toBe(200);
    const { Payment } = await response.json();
    expect(Payment).toMatchObject({
      Id: expect.stringMatching(/^\d+$/),
      SyncToken: "0",
      TotalAmt: 235,
      UnappliedAmt: 0,
      TxnDate: "2026-07-13",
      ProcessPayment: false,
      CustomerRef: { value: "3", name: invoice.CustomerRef.name },
      Line: [{ Amount: 235, LinkedTxn: [{ TxnId: invoice.Id, TxnType: "Invoice" }] }],
      domain: "QBO",
      sparse: false,
    });

    const { Invoice: paid } = await (await harness.qboGet(`/invoice/${invoice.Id}`)).json();
    expect(paid).toMatchObject({ Balance: 0, TotalAmt: 235, LinkedTxn: [{ TxnId: Payment.Id, TxnType: "Payment" }] });
  });

  it("applies a partial payment, leaving the rest of the balance open", async () => {
    const harness = setup();
    const invoice = await invoiceFor(harness, "3", 500);
    const pay = async (amount: number) =>
      (
        await (
          await harness.qboPost("/payment", { CustomerRef: { value: "3" }, TotalAmt: amount, Line: [applyTo(invoice.Id, amount)] })
        ).json()
      ).Payment.Id;
    const first = await pay(200);
    const second = await pay(120.5);

    const { Invoice } = await (await harness.qboGet(`/invoice/${invoice.Id}`)).json();
    expect(Invoice.Balance).toBe(179.5);
    expect(Invoice.LinkedTxn).toEqual([
      { TxnId: first, TxnType: "Payment" },
      { TxnId: second, TxnType: "Payment" },
    ]);
  });

  it("pays several invoices with one payment and keeps the remainder as UnappliedAmt (a credit)", async () => {
    const harness = setup();
    const first = await invoiceFor(harness, "5", 100);
    const second = await invoiceFor(harness, "5", 150);
    const { Payment } = await (
      await harness.qboPost("/payment", {
        CustomerRef: { value: "5" },
        TotalAmt: 300,
        Line: [applyTo(first.Id, 100), applyTo(second.Id, 150)],
      })
    ).json();
    expect(Payment.UnappliedAmt).toBe(50);

    // "A Payment can be created as unapplied to any Invoice ... in which case it is recorded as a credit."
    const { Payment: credit } = await (await harness.qboPost("/payment", { CustomerRef: { value: "5" }, TotalAmt: 25 })).json();
    expect(credit).toMatchObject({ TotalAmt: 25, UnappliedAmt: 25, Line: [] });
  });

  it("reads a payment back by Id", async () => {
    const harness = setup();
    const { Payment } = await (await harness.qboPost("/payment", { CustomerRef: { value: "1" }, TotalAmt: 10 })).json();
    expect((await (await harness.qboGet(`/payment/${Payment.Id}`)).json()).Payment).toEqual(Payment);
    expect((await harness.qboGet("/payment/999")).status).toBe(400);
  });

  it("refuses to pay more than an invoice's balance, or apply more than the payment's total", async () => {
    const harness = setup();
    const invoice = await invoiceFor(harness, "3", 100);
    const overpay = await harness.qboPost("/payment", { CustomerRef: { value: "3" }, TotalAmt: 150, Line: [applyTo(invoice.Id, 150)] });
    expect((await errorOf(overpay)).code).toBe("6000");

    const overapply = await harness.qboPost("/payment", { CustomerRef: { value: "3" }, TotalAmt: 50, Line: [applyTo(invoice.Id, 80)] });
    expect((await errorOf(overapply)).code).toBe("6000");

    const { Invoice } = await (await harness.qboGet(`/invoice/${invoice.Id}`)).json();
    expect(Invoice.Balance).toBe(100); // nothing half-applied
  });

  it("refuses to apply a payment to another customer's invoice", async () => {
    const harness = setup();
    const invoice = await invoiceFor(harness, "3", 100);
    const response = await harness.qboPost("/payment", { CustomerRef: { value: "4" }, TotalAmt: 100, Line: [applyTo(invoice.Id, 100)] });
    expect((await errorOf(response)).code).toBe("6000");
  });

  it("requires TotalAmt and CustomerRef (2020), and invoices that exist (2500)", async () => {
    const harness = setup();
    expect(await errorOf(await harness.qboPost("/payment", { CustomerRef: { value: "1" } }))).toMatchObject({
      code: "2020",
      element: "TotalAmt",
    });
    expect(await errorOf(await harness.qboPost("/payment", { TotalAmt: 5 }))).toMatchObject({ code: "2020", element: "CustomerRef" });
    const missing = await harness.qboPost("/payment", { CustomerRef: { value: "1" }, TotalAmt: 5, Line: [applyTo("999", 5)] });
    expect(await errorOf(missing)).toMatchObject({ code: "2500", element: "Line.LinkedTxn.TxnId" });
  });

  it("shows up in the change list as the payment, then the invoice it paid", async () => {
    const harness = setup();
    const invoice = await invoiceFor(harness, "3", 80);
    createCheckpoint(harness.twin, "before-payment");
    await harness.qboPost("/payment", { CustomerRef: { value: "3" }, TotalAmt: 80, Line: [applyTo(invoice.Id, 80)] });

    const summaries = listChanges(harness.twin, "before-payment").map((change) => change.summary);
    expect(summaries).toHaveLength(2);
    expect(summaries[0]).toMatch(/PaymentCreated Id=\d+ ".+" TotalAmt=80\.00 UnappliedAmt=0\.00/);
    expect(summaries[1]).toMatch(
      new RegExp(`InvoiceUpdated Id=${invoice.Id} DocNumber=1001 ".+" TotalAmt=80\\.00 Balance=0\\.00 SyncToken=1`),
    );
  });

  it("changes the invoice's SyncToken, so code holding the old one gets a Stale Object error", async () => {
    const harness = setup();
    const invoice = await invoiceFor(harness, "3", 80);
    await harness.qboPost("/payment", { CustomerRef: { value: "3" }, TotalAmt: 80, Line: [applyTo(invoice.Id, 80)] });
    const stale = await harness.qboPost("/invoice", {
      Id: invoice.Id,
      SyncToken: invoice.SyncToken,
      sparse: true,
      PrivateNote: "late edit",
    });
    expect((await errorOf(stale)).code).toBe("5010");
  });
});
