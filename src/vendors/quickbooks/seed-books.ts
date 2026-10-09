import { multiplyMoney, sumMoney } from "../../core/money.ts";
import type { NewEvent } from "../../core/types.ts";
import type { World } from "../../world/generate-world.ts";
import type { QboCustomer, QboInvoice, QboPayment, QboSalesItemLine } from "./types.ts";

/**
 * The books as the bookkeeper has entered them: two weeks behind the field.
 *
 * Invoices issued more than BOOKKEEPING_LAG_DAYS ago are in QuickBooks, entered that long after they were
 * issued, with Jobber's invoice number as the DocNumber (how businesses keep the two systems matched).
 * Payments made more than BOOKKEEPING_LAG_DAYS ago are recorded against them the same way. Everything newer
 * is missing on purpose: syncing it is the job of the code under test.
 */
export const BOOKKEEPING_LAG_DAYS = 14;
const LAG_MS = BOOKKEEPING_LAG_DAYS * 86_400_000;

export function seedBooks(world: World, customers: QboCustomer[]): NewEvent[] {
  const events: NewEvent[] = [];
  const cutoff = Date.parse(world.asOf) - LAG_MS;
  const customerFor = (key: string) => customers[world.customers.findIndex((customer) => customer.key === key)]!;
  const itemId = (catalogKey: string) => String(world.catalog.findIndex((entry) => entry.key === catalogKey) + 1);

  const entered = world.history.invoices.filter((invoice) => Date.parse(invoice.issuedAt) <= cutoff);
  const invoices = new Map<string, QboInvoice>();
  entered.forEach((worldInvoice, index) => {
    const customer = customerFor(worldInvoice.customerKey);
    const lines: QboSalesItemLine[] = worldInvoice.lineItems.map((line, lineIndex) => ({
      Id: String(lineIndex + 1),
      LineNum: lineIndex + 1,
      Description: line.description,
      Amount: multiplyMoney(line.quantity, line.unitPrice),
      DetailType: "SalesItemLineDetail",
      SalesItemLineDetail: { ItemRef: { value: itemId(line.catalogKey), name: line.name }, Qty: line.quantity, UnitPrice: line.unitPrice },
    }));
    const total = sumMoney(lines.map((line) => line.Amount));
    const enteredAt = iso(Date.parse(worldInvoice.issuedAt) + LAG_MS);
    const invoice: QboInvoice = {
      Id: String(index + 1),
      SyncToken: "0",
      DocNumber: String(worldInvoice.number),
      TxnDate: worldInvoice.issuedAt.slice(0, 10),
      DueDate: worldInvoice.dueAt.slice(0, 10),
      CustomerRef: { value: customer.Id, name: customer.DisplayName },
      Line: [...lines, { Amount: total, DetailType: "SubTotalLineDetail", SubTotalLineDetail: {} }],
      TotalAmt: total,
      Balance: total,
      LinkedTxn: [],
      ...(customer.BillAddr && { BillAddr: customer.BillAddr }),
      MetaData: { CreateTime: enteredAt, LastUpdatedTime: enteredAt },
    };
    invoices.set(worldInvoice.key, invoice);
    events.push({ vendor: "quickbooks", type: "InvoiceCreated", data: { invoice } });
  });

  const paid = entered
    .filter((invoice) => invoice.paidAt && Date.parse(invoice.paidAt) <= cutoff)
    .sort((a, b) => a.paidAt!.localeCompare(b.paidAt!));
  paid.forEach((worldInvoice, index) => {
    const invoice = invoices.get(worldInvoice.key)!;
    const enteredAt = iso(Date.parse(worldInvoice.paidAt!) + LAG_MS);
    const payment: QboPayment = {
      Id: String(index + 1),
      SyncToken: "0",
      TxnDate: worldInvoice.paidAt!.slice(0, 10),
      CustomerRef: invoice.CustomerRef,
      TotalAmt: invoice.TotalAmt,
      UnappliedAmt: 0,
      Line: [{ Amount: invoice.TotalAmt, LinkedTxn: [{ TxnId: invoice.Id, TxnType: "Invoice" }] }],
      ProcessPayment: false,
      MetaData: { CreateTime: enteredAt, LastUpdatedTime: enteredAt },
    };
    const paidInvoice: QboInvoice = {
      ...invoice,
      SyncToken: "1",
      Balance: 0,
      LinkedTxn: [{ TxnId: payment.Id, TxnType: "Payment" }],
      MetaData: { CreateTime: invoice.MetaData.CreateTime, LastUpdatedTime: enteredAt },
    };
    events.push({ vendor: "quickbooks", type: "PaymentCreated", data: { payment } });
    events.push({ vendor: "quickbooks", type: "InvoiceUpdated", data: { invoice: paidInvoice } });
  });

  return events;
}

function iso(ms: number): string {
  return new Date(ms).toISOString();
}
