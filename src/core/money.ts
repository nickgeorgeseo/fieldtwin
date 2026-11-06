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

/**
 * quantity × unit price, rounded to the cent (1.5 hours at 110.00 is 165.00, never 164.99999; 400 at 0.0125 is 5.00).
 * Multiplied exactly, as the numbers were written: a floating-point product can land a hair either side of half a
 * cent, and 1 × 10.004999999 is just under it, so it rounds down to 10.00, where snapping the product would make 10.01.
 */
export function multiplyMoney(quantity: number, unitPrice: number): number {
  if (!Number.isFinite(quantity) || !Number.isFinite(unitPrice)) return Number.NaN;
  const a = writtenDecimal(quantity);
  const b = writtenDecimal(unitPrice);
  const product = a.digits * b.digits; // in units of 10^-(a.scale + b.scale)
  const toCent = a.scale + b.scale - 2;
  const divisor = 10n ** BigInt(Math.max(0, toCent));
  const cents = toCent <= 0 ? product * 10n ** BigInt(-toCent) : (product + divisor / 2n) / divisor; // half a cent up
  return fromCents(Math.sign(quantity) * Math.sign(unitPrice) * Number(cents));
}

/** |value| as the shortest decimal that reads back as it (33.33, not 33.3299999...): digits × 10^-scale. */
function writtenDecimal(value: number): { digits: bigint; scale: number } {
  const [mantissa = "0", exponent = "0"] = String(Math.abs(value)).split("e"); // 1e-7, 1e+21
  const [whole = "0", fraction = ""] = mantissa.split(".");
  const scale = fraction.length - Number(exponent);
  const digits = BigInt(whole + fraction);
  return scale >= 0 ? { digits, scale } : { digits: digits * 10n ** BigInt(-scale), scale: 0 };
}

/** Whether two amounts are equal to the cent. */
export function sameMoney(a: number, b: number): boolean {
  return toCents(a) === toCents(b);
}

/** "1234.50": always two decimals, for logs and descriptions. */
export function formatMoney(amount: number): string {
  return fromCents(toCents(amount)).toFixed(2);
}
