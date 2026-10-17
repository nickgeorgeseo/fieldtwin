import type { HcpLineItem } from "./types/index.ts";

/**
 * Money in Housecall Pro is whole cents: "Unit price in cents (e.g., 10000 = $100.00)", and every total is an integer.
 * Quantities "can be a float up to two decimal places", so a line rounds to the nearest cent.
 */
export function lineAmount(line: HcpLineItem): number {
  return Math.round(line.quantity * line.unit_price);
}

/** What lines come to, in cents. The world has no tax rate or discounts, so this is a subtotal and a total. */
export function linesTotal(lines: readonly HcpLineItem[]): number {
  return lines.reduce((total, line) => total + lineAmount(line), 0);
}
