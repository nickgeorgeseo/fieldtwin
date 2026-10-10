import type { JobberLineItem } from "./jobber-invoices.ts";
import type * as books from "./quickbooks-entities.ts";

/**
 * A Jobber line item as a QuickBooks sales line, booked to the Item `itemId`. QuickBooks refuses a line whose Amount
 * isn't Qty × UnitPrice to the cent (6070), and a Jobber price can be finer than a cent, so Qty and UnitPrice go along
 * only when they agree with the total. Otherwise the line is booked at its total, and its description says how
 * Jobber priced it: an invoice that fails every run would hold the scheduled sync's cutoff back for good.
 */
export function salesLineFor(line: JobberLineItem, itemId: string): books.SalesLine {
  const description = line.description ?? line.name;
  const agrees = line.unitPrice !== null && cents(line.quantity * line.unitPrice) === cents(line.totalPrice);
  const priced = line.unitPrice === null ? { Qty: line.quantity } : agrees ? { Qty: line.quantity, UnitPrice: line.unitPrice } : {};
  return {
    DetailType: "SalesItemLineDetail",
    Amount: line.totalPrice,
    Description: agrees || line.unitPrice === null ? description : `${description} (${line.quantity} × ${line.unitPrice})`,
    SalesItemLineDetail: { ItemRef: { value: itemId }, ...priced },
  };
}

/** Whole cents, half a cent rounding away from zero. toFixed first: 2.5 × 33.33 is 83.32499999999999 in floating point. */
export function cents(amount: number): number {
  return Math.sign(amount) * Math.round(Number((Math.abs(amount) * 100).toFixed(6)));
}
