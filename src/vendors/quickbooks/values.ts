import { fromCents, toCents } from "../../core/money.ts";
import { type QboFault, qboErrors } from "./errors.ts";

/**
 * Values as QuickBooks reads them from a request. Numbers: JSON numbers, or numeric strings, which SDKs such as
 * python-quickbooks send for decimals. Amounts: dollars and whole cents; the docs give no limits, so the twin refuses
 * fractions of a cent and amounts too big to add up exactly, with 2140 Invalid Amount (FIDELITY.md marks both
 * "check"). Text: strings, or numbers read as their digits.
 * https://developer.intuit.com/app/developer/qbo/docs/develop/troubleshooting/error-codes
 */
const MAX_AMOUNT = 999_999_999_999.99;

/** A number sent as a JSON number or a numeric string; undefined for anything else. */
export function numberFrom(value: unknown): number | undefined {
  if (typeof value === "number") return Number.isFinite(value) ? value : undefined;
  if (typeof value === "string" && /^\s*-?\d+(\.\d+)?\s*$/.test(value)) return numberFrom(Number(value)); // "999...9": Infinity
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
  // Floating point stores 136216566.02 as a hair under, so allow for its rounding, which grows with the amount.
  const cents = amount * 100;
  if (Math.abs(cents - Math.round(cents)) > Math.max(1e-6, Math.abs(cents) * Number.EPSILON * 4)) {
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

/**
 * Text fields as QuickBooks' JSON reader takes them: a string as sent, a number as its digits. Anything else (an
 * object, a list) answers 2010 naming the field. Normalizes `fields` in place; the Fault, if any, is returned.
 */
export function readTextFields(fields: object, names: readonly string[], now: string): QboFault | undefined {
  const record = fields as Record<string, unknown>;
  for (const name of names) {
    const value = record[name];
    if (typeof value === "number" && Number.isFinite(value)) record[name] = String(value);
    else if (value !== undefined && value !== null && typeof value !== "string") {
      return qboErrors.invalidProperty(name, `${name} must be text, not ${JSON.stringify(value)}.`, now);
    }
  }
  return undefined;
}

/**
 * Text fields' documented maximum lengths, by path (`PrimaryPhone.FreeFormNumber`): the Fault for the first one a
 * value exceeds, 2050 Invalid String Length, or undefined. Run after readTextFields, so numbers count as their digits.
 */
export function checkLengths(fields: object, maxima: Readonly<Record<string, number>>, now: string): QboFault | undefined {
  for (const [path, max] of Object.entries(maxima)) {
    let value: unknown = fields;
    for (const key of path.split(".")) value = (value as Record<string, unknown> | undefined)?.[key];
    if (typeof value === "string" && value.length > max) return qboErrors.stringTooLong(path, max, value.length, now);
  }
  return undefined;
}
