/**
 * Housecall Pro's amounts, in cents, as the twin works them out (src/vendors/housecallpro/amounts.ts), so the Business
 * page and the event feed add up its lines the way its invoices do.
 */

/**
 * A line in cents: the quantity, counted in hundredths, times the unit price in cents, to the nearest cent, half a cent
 * up. Multiplying the quantity as it is would round some half cents down: 2.01 × 3450 is 6934.4999... in floating point.
 */
function hcpLineCents({ quantity, unit_price }: { quantity: number; unit_price: number }): number {
  return Math.round((Math.round(quantity * 100) * unit_price) / 100);
}

/** What lines come to, in cents, added up as the twin adds them. */
export function hcpLinesCents(lines: readonly { quantity: number; unit_price: number }[]): number {
  return lines.reduce((total, line) => total + hcpLineCents(line), 0);
}
