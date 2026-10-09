/**
 * Money arithmetic in whole cents, so totals never pick up floating-point dust (0.1 + 0.2 !== 0.3).
 * Vendor APIs send and receive decimal numbers; convert at the edges and add up in cents.
 */

export function toCents(amount: number): number {
  return Math.round(amount * 100);
}

export function fromCents(cents: number): number {
  return cents / 100;
}

/** Add amounts exactly. */
export function sumMoney(amounts: readonly number[]): number {
  return fromCents(amounts.reduce((total, amount) => total + toCents(amount), 0));
}

/** Whether two amounts are equal to the cent. */
export function sameMoney(a: number, b: number): boolean {
  return toCents(a) === toCents(b);
}

/** "1234.50": always two decimals, for logs and descriptions. */
export function formatMoney(amount: number): string {
  return fromCents(toCents(amount)).toFixed(2);
}
