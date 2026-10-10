import { fromCents, toCents } from "../../core/money.ts";
import { type QboFault, qboErrors } from "./errors.ts";

/**
 * Numbers as QuickBooks reads them: JSON numbers, or numeric strings, which SDKs such as python-quickbooks send for
 * decimals. Amounts are dollars and whole cents. The docs give no limits, so the twin refuses fractions of a cent and
 * amounts too big to add up exactly, with 2140 Invalid Amount (FIDELITY.md marks both "check").
 * https://developer.intuit.com/app/developer/qbo/docs/develop/troubleshooting/error-codes
 */
const MAX_AMOUNT = 999_999_999_999.99;

/** A number sent as a JSON number or a numeric string; undefined for anything else. */
export function numberFrom(value: unknown): number | undefined {
  if (typeof value === "number") return Number.isFinite(value) ? value : undefined;
  if (typeof value === "string" && /^\s*-?\d+(\.\d+)?\s*$/.test(value)) return Number(value);
  return undefined;
}

/** A required amount, or the Fault for one that is missing, negative, or not dollars and cents. */
export function readAmount(value: unknown, element: string, now: string): number | QboFault {
  if (value === undefined || value === null) return qboErrors.missingField(element, now);
  const amount = numberFrom(value);
  if (amount === undefined || Math.abs(amount) > MAX_AMOUNT) {
    return qboErrors.invalidAmount(element, `${element} must be an amount up to ${MAX_AMOUNT}, not ${JSON.stringify(value)}.`, now);
  }
  if (amount < 0) return qboErrors.negativeAmount(element, now);
  const cents = amount * 100;
  if (Math.abs(cents - Math.round(cents)) > 1e-6) {
    return qboErrors.invalidAmount(
      element,
      `${element} is in fractions of a cent: ${JSON.stringify(value)}. Round it to two decimals.`,
      now,
    );
  }
  return fromCents(toCents(amount));
}

/** An optional unit price (any precision) or quantity: undefined if not sent, or the Fault for one that isn't a number. */
export function readOptionalNumber(
  value: unknown,
  element: string,
  kind: "price" | "quantity",
  now: string,
): number | undefined | QboFault {
  if (value === undefined || value === null) return undefined;
  const number = numberFrom(value);
  if (number !== undefined) return number;
  const detail = `${element} must be a number, not ${JSON.stringify(value)}.`;
  return kind === "quantity" ? qboErrors.invalidQuantity(element, detail, now) : qboErrors.invalidAmount(element, detail, now);
}
