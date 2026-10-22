import { lineAmount, linesTotal } from "../amounts.ts";
import { dueAmount, invoiceStatus } from "../statuses.ts";
import type { HcpInvoice } from "../types/index.ts";

/**
 * An invoice as the API answers with it, the reference's JobInvoice. Amounts are cents; `due_amount` is what the
 * payments haven't covered. Get Invoices: https://docs.housecallpro.com/docs/housecall-public-api/65ce9f430d605-get-invoices
 */
export function invoiceResponse(invoice: HcpInvoice, withJobId: boolean) {
  const amount = linesTotal(invoice.items);
  return {
    id: invoice.id,
    status: invoiceStatus(invoice),
    invoice_number: invoice.invoice_number,
    amount,
    subtotal: amount, // the world has no tax rate or discounts
    due_amount: dueAmount(invoice),
    due_at: invoice.due_at,
    display_due_concept: null, // the docs don't say what these hold
    due_concept: null,
    paid_at: invoice.paid_at,
    sent_at: invoice.sent_at,
    service_date: invoice.service_date,
    invoice_date: invoice.invoice_date,
    items: invoice.items.map((item) => ({
      id: item.id,
      name: item.name,
      unit_cost: item.unit_cost,
      unit_price: item.unit_price,
      qty_in_hundredths: Math.round(item.quantity * 100),
      amount: lineAmount(item),
      invoiced_amount: lineAmount(item), // "for a standalone invoice it equals amount"
      description: item.description,
      type: item.kind,
    })),
    taxes: [],
    discounts: [],
    payments: invoice.payments.map((payment) => ({ ...payment, category: null })),
    // Get Invoices and Get Invoice by UUID add the job's id; a job's own list of invoices doesn't.
    ...(withJobId && { job_id: invoice.job_id }),
  };
}
