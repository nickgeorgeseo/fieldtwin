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
 * Either may be decimal text, as a client wrote it ("10.00499999999999999", more digits than a double holds).
 */
export function multiplyMoney(quantity: number | string, unitPrice: number | string): number {
  const a = writtenDecimal(quantity);
  const b = writtenDecimal(unitPrice);
  if (!a || !b) return Number.NaN;
  const product = a.digits * b.digits; // in units of 10^-(a.scale + b.scale)
  const toCent = a.scale + b.scale - 2;
  const divisor = 10n ** BigInt(Math.max(0, toCent));
  const cents = toCent <= 0 ? product * 10n ** BigInt(-toCent) : (product + divisor / 2n) / divisor; // half a cent up
  return cents === 0n ? 0 : fromCents((a.negative === b.negative ? 1 : -1) * Number(cents));
}

/**
 * The unit price to store for a line whose Qty × UnitPrice was checked as written: the nearest double, or the next
 * one toward the written text when that double's shortest form lands on the other side of half a cent ("10.00499999
 * 999999999" reads as 10.005, which would make 10.01). A client that sends back the price it read then gets the
 * Amount it was charged, so the stored line stays updatable.
 */
export function storedUnitPrice(quantity: number, unitPrice: number, amount: number): number {
  let price = unitPrice;
  for (let step = 0; step < 8 && !sameMoney(multiplyMoney(quantity, price), amount); step++) {
    const short = multiplyMoney(quantity, price) < amount === quantity > 0; // the product is short: raise the price
    price = nextDouble(price, short ? 1 : -1);
  }
  return sameMoney(multiplyMoney(quantity, price), amount) ? price : unitPrice;
}

/** The double next to `value`, up (1) or down (-1). */
function nextDouble(value: number, direction: 1 | -1): number {
  if (value === 0) return direction * Number.MIN_VALUE;
  const bits = new BigInt64Array(new Float64Array([value]).buffer);
  bits[0] = (bits[0] ?? 0n) + (Math.sign(value) === direction ? 1n : -1n); // a larger bit pattern is a larger magnitude
  return new Float64Array(bits.buffer)[0] ?? value;
}

/**
 * A value as the decimal it was written as: digits × 10^-scale. Text is read digit for digit, up to 40 either side
 * of the point (past that, or with an exponent, as the number it reads as, so a huge exponent can't make huge
 * BigInts). A number is read as the shortest decimal that reads back as it (33.33, not 33.3299999...).
 */
function writtenDecimal(value: number | string): { negative: boolean; digits: bigint; scale: number } | undefined {
  if (typeof value === "string" && !/^\s*-?\d{1,40}(\.\d{1,40})?\s*$/.test(value)) return writtenDecimal(Number(value));
  if (typeof value === "number" && !Number.isFinite(value)) return undefined;
  const text = String(value).trim();
  const [mantissa = "0", exponent = "0"] = text.replace(/^-/, "").split("e"); // 1e-7, 1e+21
  const [whole = "0", fraction = ""] = mantissa.split(".");
  const scale = fraction.length - Number(exponent);
  const digits = BigInt(whole + fraction);
  const negative = text.startsWith("-");
  return scale >= 0 ? { negative, digits, scale } : { negative, digits: digits * 10n ** BigInt(-scale), scale: 0 };
}

/** Whether two amounts are equal to the cent. */
export function sameMoney(a: number, b: number): boolean {
  return toCents(a) === toCents(b);
}

/** "1234.50": always two decimals, for logs and descriptions. */
export function formatMoney(amount: number): string {
  return fromCents(toCents(amount)).toFixed(2);
}
