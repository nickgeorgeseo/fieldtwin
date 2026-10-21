import { readUtcTime } from "../../../core/clock.ts";
import { type ListRequest, listParam } from "./lists.ts";

/** Pieces the lists' filters share. Each list documents its own filters; see work-filters.ts and invoices.ts. */

export type Test<T> = (record: T) => boolean;

/**
 * `<field>_min` and `<field>_max` filters on times: "greater than or equal to" and "less than or equal to the date
 * sent". A time without an offset is UTC, as the docs write times ("ISO-8601 formatted date string in UTC"). A record
 * without the time matches neither. Adds a test per filter sent, or says what's wrong with one.
 */
export function timeRange<T>(
  req: ListRequest,
  name: string,
  read: (record: T) => string | null | undefined,
  tests: Test<T>[],
): string | undefined {
  for (const bound of ["min", "max"] as const) {
    const value = req.query(`${name}_${bound}`);
    if (!value) continue;
    const limit = readUtcTime(value);
    if (limit === undefined) return `${name}_${bound} must be a date or a date and time in UTC, like 2026-07-13T15:30:00, not "${value}".`;
    tests.push((record) => {
      const time = read(record);
      if (!time) return false;
      return bound === "min" ? Date.parse(time) >= limit : Date.parse(time) <= limit;
    });
  }
  return undefined;
}

/** `<field>_min` and `<field>_max` filters on amounts, in cents like every amount. */
export function amountRange<T>(req: ListRequest, name: string, read: (record: T) => number, tests: Test<T>[]): string | undefined {
  for (const bound of ["min", "max"] as const) {
    const value = req.query(`${name}_${bound}`);
    if (!value) continue;
    const limit = Number(value);
    if (!/^-?\d+(\.\d+)?$/.test(value)) return `${name}_${bound} must be an amount in cents, like 15000, not "${value}".`;
    tests.push((record) => (bound === "min" ? read(record) >= limit : read(record) <= limit));
  }
  return undefined;
}

/** A filter on one of a list of values, refusing a value the list doesn't document. */
export function oneOf<T>(
  req: ListRequest,
  name: string,
  allowed: readonly string[],
  read: (record: T) => string[],
  tests: Test<T>[],
): string | undefined {
  const asked = listParam(req, name);
  const unknown = asked.find((value) => !allowed.includes(value));
  if (unknown !== undefined) return `${name} takes ${allowed.join(", ")}, not "${unknown}".`;
  if (asked.length) tests.push((record) => read(record).some((value) => asked.includes(value)));
  return undefined;
}
