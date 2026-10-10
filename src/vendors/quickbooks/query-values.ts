import { qboDate, qboDateTimeMs } from "./dates.ts";
import type { QboQuery, QueryCondition, QueryOperator, QueryValue } from "./query-language.ts";

/**
 * How query values compare: https://developer.intuit.com/app/developer/qbo/docs/learn/explore-the-quickbooks-online-api/data-queries
 * Each property compares as one kind of value, the same way in WHERE and in ORDERBY, so sorting is a consistent
 * order. Text is text however many digits it holds (DocNumber "100" sorts before "90"); only Ids and references,
 * which QuickBooks numbers, compare as whole numbers.
 */
export const METADATA = ["MetaData.CreateTime", "MetaData.LastUpdatedTime"]; // instants
const DATES = ["TxnDate", "DueDate"]; // YYYY-MM-DD
const NUMBERS = ["TotalAmt", "Balance"]; // quoted or not: TotalAmt > '1000.0'
const IDS = ["Id", "CustomerRef"]; // whole numbers, digit for digit however long
const BOOLEANS = ["Active"];

/** A value as it compares, for its property. undefined if the twin can't read it as that kind of value. */
export function comparable(property: string, value: unknown): unknown {
  if (value === undefined || value === null) return undefined;
  if (METADATA.includes(property)) return qboDateTimeMs(String(value));
  if (DATES.includes(property)) return qboDate(value);
  if (NUMBERS.includes(property)) {
    if (typeof value === "number") return value;
    return typeof value === "string" && /^-?\d+(\.\d+)?$/.test(value) ? Number(value) : undefined;
  }
  if (BOOLEANS.includes(property)) {
    const text = String(value).toLowerCase();
    return text === "true" ? true : text === "false" ? false : undefined;
  }
  return String(value);
}

export function unreadableValue(property: string, value: QueryValue): string {
  if (METADATA.includes(property)) {
    return `'${value}' isn't a date-time the twin can read for ${property}. Use a form like '2026-07-13T11:00:00-05:00'`;
  }
  if (NUMBERS.includes(property)) return `'${value}' isn't a number the twin can read for ${property}. Use a form like '1000.00'`;
  if (BOOLEANS.includes(property)) return `${property} is true or false, not '${value}'`;
  return `'${value}' isn't a date the twin can read for ${property}. Use a form like '2026-07-13'`;
}

const ORDER_TESTS: Record<Exclude<QueryOperator, "like">, (order: number) => boolean> = {
  "=": (order) => order === 0,
  in: (order) => order === 0,
  "<": (order) => order < 0,
  ">": (order) => order > 0,
  "<=": (order) => order <= 0,
  ">=": (order) => order >= 0,
};

/** Whether a record's value (as comparable() gives it) meets a condition. A record without the property never does. */
export function holds({ property, operator, values }: QueryCondition, actual: unknown): boolean {
  if (actual === undefined) return false;
  if (operator === "like") return likePattern(String(values[0])).test(String(actual));
  return values.some((wanted) => ORDER_TESTS[operator](compareValues(property, actual, wanted)));
}

/** "Wildcard character support for LIKE clauses is limited to '%'": every other character matches itself. */
function likePattern(pattern: string): RegExp {
  const literal = pattern.split("%").map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  return new RegExp(`^${literal.join(".*")}$`, "is");
}

/** Records without a property sort as its lowest value: first ascending, last descending. Ties keep the default order. */
export function bySortKeys(keys: QboQuery["orderBy"], valueAt: (record: object, property: string) => unknown) {
  return (a: object, b: object): number => {
    for (const { property, descending } of keys) {
      const x = comparable(property, valueAt(a, property));
      const y = comparable(property, valueAt(b, property));
      const order = x === undefined ? (y === undefined ? 0 : -1) : y === undefined ? 1 : compareValues(property, x, y);
      if (order !== 0) return descending ? -order : order;
    }
    return 0;
  };
}

/** Two comparable values of one property: numbers and instants by value, false before true, text without regard to case. */
function compareValues(property: string, a: unknown, b: unknown): number {
  if (typeof a === "number" && typeof b === "number") return Math.sign(a - b);
  if (typeof a === "boolean" && typeof b === "boolean") return Number(a) - Number(b);
  const [s, t] = [String(a), String(b)];
  if (IDS.includes(property) && /^\d+$/.test(s) && /^\d+$/.test(t)) return compareWholeNumbers(s, t);
  // "Attribute values are also not case sensitive."
  const [x, y] = [s.toLowerCase(), t.toLowerCase()];
  return x < y ? -1 : x > y ? 1 : 0;
}

/** Digit strings as whole numbers, exactly, however long: fewer digits is smaller, then digit by digit. */
function compareWholeNumbers(a: string, b: string): number {
  const [x, y] = [a.replace(/^0+(?=\d)/, ""), b.replace(/^0+(?=\d)/, "")];
  if (x.length !== y.length) return Math.sign(x.length - y.length);
  return x < y ? -1 : x > y ? 1 : 0;
}
