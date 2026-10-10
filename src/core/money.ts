/**
 * Money arithmetic in whole cents, so totals never pick up floating-point dust (0.1 + 0.2 !== 0.3).
 * Vendor APIs send and receive decimal numbers; convert at the edges and add up in cents.
 */

/**
 * Whole cents, rounding half a cent away from zero. toFixed first: 1.005 is really 1.00499999999999989..., and
 * 2.5 × 33.33 comes out as 83.32499999999999, both of which mean the half cent they were written as.
 */
export function toCents(amount: number): number {
  return Math.sign(amount) * Math.round(Number((Math.abs(amount) * 100).toFixed(6)));
}

export function fromCents(cents: number): number {
  return cents / 100;
}

/** Add amounts exactly. */
export function sumMoney(amounts: readonly number[]): number {
  return fromCents(amounts.reduce((total, amount) => total + toCents(amount), 0));
}

/** quantity × unit price, rounded to the cent (1.5 hours at 110.00 is 165.00, never 164.99999; 400 at 0.0125 is 5.00). */
export function multiplyMoney(quantity: number, unitPrice: number): number {
  return fromCents(toCents(quantity * unitPrice));
}

/** Whether two amounts are equal to the cent. */
export function sameMoney(a: number, b: number): boolean {
  return toCents(a) === toCents(b);
}

/** "1234.50": always two decimals, for logs and descriptions. */
export function formatMoney(amount: number): string {
  return fromCents(toCents(amount)).toFixed(2);
}
