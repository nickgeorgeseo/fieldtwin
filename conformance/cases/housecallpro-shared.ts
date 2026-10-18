import { type Answer, expectOk, housecallpro, type Observation, type Observations, type Target } from "../case.ts";

/**
 * How the Housecall Pro cases boil answers down to observations. A twin and a real account hold different records,
 * with different ids, names, and times, so cases keep only what can't differ: statuses, the shape of a body, and
 * yes-or-no facts.
 */

/** A body's shape without its values: each key, in order, with the kind of value it holds ("string", a list, ...). */
export function shapeOf(value: unknown, depth = 0): Observation {
  if (value === null || value === undefined) return null;
  if (Array.isArray(value)) return value.length && depth < 4 ? [shapeOf(value[0], depth + 1)] : [];
  if (typeof value !== "object") return typeof value;
  if (depth >= 4) return "object";
  const record = value as Record<string, unknown>;
  return Object.fromEntries(
    Object.keys(record)
      .sort()
      .map((key) => [key, shapeOf(record[key], depth + 1)]),
  );
}

/**
 * How a request went: its status and, for an error, the shape of its body, which is what clients read to say why.
 * Never under the key "error": that is how a run marks a case that couldn't finish (run.ts).
 */
export function errorOf(answer: Answer): Observations {
  return answer.status < 300 ? { status: answer.status } : { status: answer.status, body: shapeOf(answer.body) };
}

/**
 * The id of the first record in a list ("customers", "jobs"), to model an unknown one on. An id in a form the account
 * doesn't use, with another prefix or none, might be refused as malformed: a question other than whether it exists.
 */
export async function firstId(target: Target, list: string): Promise<string> {
  const id: unknown = expectOk(await housecallpro(target, "GET", `/${list}?page_size=1`), `list ${list}`)?.[list]?.[0]?.id;
  if (typeof id === "string") return id;
  throw new Error(
    `The account has no ${list}, so this case can't tell: it makes an unknown id in the form of one. Make one in Housecall Pro first.`,
  );
}

/** An id in the form of `id` that no record has: every hex digit after its prefix ("cus_") made 0. */
export function noneLike(id: string): string {
  const start = id.lastIndexOf("_") + 1;
  return id.slice(0, start) + id.slice(start).replace(/[0-9a-f]/gi, "0");
}
