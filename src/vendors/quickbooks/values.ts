import { fromCents, toCents } from "../../core/money.ts";
import { shown } from "../../core/request-body.ts";
import { type QboFault, qboErrors } from "./errors.ts";

/**
 * Values as QuickBooks reads them from a request. Numbers: JSON numbers, or numeric strings, which SDKs such as
 * python-quickbooks send for decimals. Amounts: dollars and whole cents; the docs give no limits, so the twin refuses
 * fractions of a cent and amounts too big to add up exactly, with 2140 Invalid Amount (FIDELITY.md marks both
 * "check"). Text: strings, or numbers read as written.
 * https://developer.intuit.com/app/developer/qbo/docs/develop/troubleshooting/error-codes
 */
const MAX_AMOUNT = 999_999_999_999.99;

/**
 * A number sent as a JSON number or a numeric string; undefined for anything else. An exponent (1E+2) is read too,
 * since keepWrittenNumbers hands on a JSON number written that way as its text.
 */
export function numberFrom(value: unknown): number | undefined {
  if (typeof value === "number") return Number.isFinite(value) ? value : undefined;
  if (typeof value === "string" && /^\s*-?\d+(\.\d+)?([eE][+-]?\d+)?\s*$/.test(value)) return numberFrom(Number(value)); // "9...9": Infinity
  return undefined;
}

/**
 * An Id or reference (Id, SyncToken, CustomerRef.value, ItemRef.value, TxnId) as QuickBooks reads it: a string as
 * sent, a number as written. Undefined for anything else (an object, a list, true), which names no record, so the
 * caller answers a validation Fault instead of turning it into text, which can throw.
 */
export function refId(value: unknown): string | undefined {
  if (typeof value === "string") return value;
  return typeof value === "number" && Number.isFinite(value) ? String(value) : undefined;
}

/** A value as a Fault's Detail shows it: text as sent, anything else as JSON. */
export function asSent(value: unknown): string {
  return typeof value === "string" ? value : shown(value);
}

/** A required amount, or the Fault for one that is missing, negative, or not dollars and cents. */
export function readAmount(value: unknown, element: string, now: string): number | QboFault {
  if (value === undefined || value === null) return qboErrors.missingField(element, now);
  const amount = numberFrom(value);
  if (amount === undefined || Math.abs(amount) > MAX_AMOUNT) {
    return qboErrors.invalidAmount(element, `${element} must be an amount up to ${MAX_AMOUNT}, not ${shown(value)}.`, now);
  }
  if (amount < 0) return qboErrors.negativeAmount(element, now);
  // Floating point stores 136216566.02 as a hair under, so allow for its rounding, which grows with the amount.
  const cents = amount * 100;
  if (Math.abs(cents - Math.round(cents)) > Math.max(1e-6, Math.abs(cents) * Number.EPSILON * 4)) {
    return qboErrors.invalidAmount(element, `${element} is in fractions of a cent: ${shown(value)}. Round it to two decimals.`, now);
  }
  return fromCents(toCents(amount));
}

/**
 * The Fault for lines that add up past the largest amount, or undefined. Each line is checked on its own, so without
 * this enough of them would total more than the twin can add up exactly, and TotalAmt and Balance would be off.
 */
export function checkTotal(total: number, now: string): QboFault | undefined {
  if (total <= MAX_AMOUNT) return undefined;
  return qboErrors.invalidAmount("TotalAmt", `The lines add up to more than ${MAX_AMOUNT}. Split them across invoices.`, now);
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
  const detail = `${element} must be a number, not ${shown(value)}.`;
  return kind === "quantity" ? qboErrors.invalidQuantity(element, detail, now) : qboErrors.invalidAmount(element, detail, now);
}

/**
 * A JSON.parse reviver for write bodies. A number JavaScript can't write back as sent (12345678901234567890 comes back
 * as 12345678901234567000, 1e21 as "1e+21", 0.0000001 as "1e-7", 1.50 as "1.5") is kept as its text, so a text field
 * reads what was written, as QuickBooks' own reader would. numberFrom reads that text as the same number as before,
 * so amounts and quantities don't change. An Id or reference written with a zero fraction (SyncToken 0.0, as Python's
 * json.dumps writes a float) names the whole number, so it reads as "0", not "0.0", which no record has.
 */
export function keepWrittenNumbers(key: string, value: unknown, context?: { source?: string }): unknown {
  const source = context?.source;
  if (typeof value !== "number" || source === undefined || String(value) === source) return value;
  const whole = ID_KEYS.has(key) ? /^(-?\d+)\.0+$/.exec(source) : null;
  return whole?.[1] ?? source;
}

/** The keys that hold an Id or reference: Id, SyncToken, a *Ref's value, a LinkedTxn's TxnId. */
const ID_KEYS = new Set(["Id", "SyncToken", "value", "TxnId"]);

/**
 * Text fields as QuickBooks' JSON reader takes them, by path (`PrimaryPhone.FreeFormNumber`): a string as sent, a
 * number as written (1.50, not 1.5). Anything else (an object, a list) answers 2010 naming the field. Normalizes
 * `fields` in place; the Fault, if any, is returned.
 */
export function readTextFields(fields: object, paths: readonly string[], now: string): QboFault | undefined {
  for (const path of paths) {
    const value = valueAt(fields, path);
    if (typeof value === "number" && Number.isFinite(value)) setAt(fields, path, String(value));
    else if (value !== undefined && value !== null && typeof value !== "string") {
      return qboErrors.invalidProperty(path, `${path} must be text, not ${shown(value)}.`, now);
    }
  }
  return undefined;
}

/**
 * Boolean fields (a customer's `Active`): true or false, as the entity references type them. Null is read as not
 * sent, as for amounts, and removed from `fields` so a sparse update keeps the stored value. Anything else ("false",
 * 0) answers 2010 naming the field: stored as sent, payments would read it one way and queries another.
 */
export function readBooleanFields(fields: object, names: readonly string[], now: string): QboFault | undefined {
  const record = fields as Record<string, unknown>;
  for (const name of names) {
    const value = record[name];
    if (value === null) delete record[name];
    else if (value !== undefined && typeof value !== "boolean") {
      return qboErrors.invalidProperty(name, `${name} must be true or false, not ${shown(value)}.`, now);
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
    const value = valueAt(fields, path);
    if (typeof value === "string" && value.length > max) return qboErrors.stringTooLong(path, max, value.length, now);
  }
  return undefined;
}

/** The value at a path like `PrimaryPhone.FreeFormNumber`, or undefined where the path runs out. */
function valueAt(fields: object, path: string): unknown {
  let value: unknown = fields;
  for (const key of path.split(".")) value = (value as Record<string, unknown> | undefined)?.[key];
  return value;
}

/**
 * Sets the value at a path valueAt found. Each object on the way is copied first: a sparse update's fields share
 * their nested objects with the stored record, which only apply() may change.
 */
function setAt(fields: object, path: string, value: unknown): void {
  const keys = path.split(".");
  const last = keys.pop() ?? path;
  let parent = fields as Record<string, unknown>;
  for (const key of keys) {
    parent[key] = { ...(parent[key] as object) };
    parent = parent[key] as Record<string, unknown>;
  }
  parent[last] = value;
}
