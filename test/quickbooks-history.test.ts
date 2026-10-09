import { describe, expect, it } from "vitest";
import { setup } from "./helpers.ts";

/**
 * QuickBooks holds the business's books as the bookkeeper has entered them: two weeks behind the field.
 * Invoices issued more than 14 days ago are in QuickBooks, numbered as in Jobber; payments made more
 * than 14 days ago are recorded against them. Everything newer is sync work for the code under test.
 */
const LAG_MS = 14 * 86_400_000;
type Harness = ReturnType<typeof setup>;

const query = async (harness: Harness, statement: string) =>
  (await (await harness.qboGet(`/query?query=${encodeURIComponent(statement)}`)).json()).QueryResponse;

describe("QuickBooks twin: the books so far", () => {
  it("has the invoices issued more than two weeks ago, with Jobber's invoice numbers as DocNumbers", async () => {
    const harness = setup();
    const cutoff = harness.twin.clock.nowMs() - LAG_MS;
    const entered = harness.twin.world.history.invoices.filter((invoice) => Date.parse(invoice.issuedAt) <= cutoff);

    const { Invoice } = await query(harness, "select * from Invoice maxresults 1000");
    expect(Invoice.map((invoice: { DocNumber: string }) => invoice.DocNumber)).toEqual(entered.map((invoice) => String(invoice.number)));
    for (const [index, invoice] of Invoice.entries()) {
      const world = entered[index]!;
      expect(invoice.TxnDate).toBe(world.issuedAt.slice(0, 10));
      expect(invoice.DueDate).toBe(world.dueAt.slice(0, 10));
      expect(invoice.TotalAmt).toBe(world.lineItems.reduce((sum, line) => sum + line.quantity * line.unitPrice, 0));
    }
  });

  it("prices invoice lines with the Items from the price list", async () => {
    const harness = setup();
    const { Invoice } = await query(harness, "select * from Invoice maxresults 1");
    const [line] = Invoice[0].Line;
    const { Item } = await (await harness.qboGet(`/item/${line.SalesItemLineDetail.ItemRef.value}`)).json();
    expect(line.SalesItemLineDetail.ItemRef.name).toBe(Item.Name);
    expect(line.SalesItemLineDetail.UnitPrice).toBe(Item.UnitPrice);
  });

  it("records payments made more than two weeks ago, and those invoices read paid", async () => {
    const harness = setup();
    const cutoff = harness.twin.clock.nowMs() - LAG_MS;
    const paidLongAgo = harness.twin.world.history.invoices.filter((invoice) => invoice.paidAt && Date.parse(invoice.paidAt) <= cutoff);

    expect((await query(harness, "select count(*) from Payment")).totalCount).toBe(paidLongAgo.length);
    for (const world of paidLongAgo) {
      const { Invoice } = await query(harness, `select * from Invoice where DocNumber = '${world.number}'`);
      expect(Invoice[0]).toMatchObject({ Balance: 0, LinkedTxn: [{ TxnType: "Payment" }] });
    }
  });

  it("leaves the last two weeks for the integration: missing invoices, and invoices paid in Jobber but open here", async () => {
    const harness = setup();
    const cutoff = harness.twin.clock.nowMs() - LAG_MS;
    const { invoices } = harness.twin.world.history;
    expect(invoices.some((invoice) => Date.parse(invoice.issuedAt) > cutoff)).toBe(true);

    const paidRecentlyButEntered = invoices.filter(
      (invoice) => Date.parse(invoice.issuedAt) <= cutoff && invoice.paidAt && Date.parse(invoice.paidAt) > cutoff,
    );
    for (const world of paidRecentlyButEntered) {
      const { Invoice } = await query(harness, `select * from Invoice where DocNumber = '${world.number}'`);
      expect(Invoice[0].Balance).toBe(Invoice[0].TotalAmt);
    }
  });

  it("dates the bookkeeping when it happened, so change data capture sees the last month of it", async () => {
    const harness = setup();
    const since = new Date(harness.twin.clock.nowMs() - 30 * 86_400_000).toISOString();
    const response = await harness.qboGet(`/cdc?entities=Invoice,Payment&changedSince=${encodeURIComponent(since)}`);
    const [invoices] = (await response.json()).CDCResponse[0].QueryResponse;
    expect(invoices.Invoice.length).toBeGreaterThan(0);
    for (const invoice of invoices.Invoice) expect(Date.parse(invoice.MetaData.LastUpdatedTime)).toBeGreaterThanOrEqual(Date.parse(since));
  });
});
