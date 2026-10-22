import type { HcpLineItem } from "./types/index.ts";

/**
 * Money in Housecall Pro is whole cents: "Unit price in cents (e.g., 10000 = $100.00)", and every total is an integer.
 * Quantities "can be a float up to two decimal places", so a line rounds to the nearest cent, half a cent up, as the
 * QuickBooks and Jobber twins round (core/money.ts). Multiplying the float as it is would round some half cents down:
 * 2.01 × 3450 is 6934.4999... in floating point. Counting the quantity in hundredths first keeps it exact.
 * Create a Job's LineItemCreate: https://docs.housecallpro.com/docs/housecall-public-api/2dcf481ed7d69-create-a-job
 */
export function lineAmount(line: Pick<HcpLineItem, "quantity" | "unit_price">): number {
  return Math.round((Math.round(line.quantity * 100) * line.unit_price) / 100);
}

/** What lines come to, in cents. The world has no tax rate or discounts, so this is a subtotal and a total. */
export function linesTotal(lines: readonly HcpLineItem[]): number {
  return lines.reduce((total, line) => total + lineAmount(line), 0);
}
