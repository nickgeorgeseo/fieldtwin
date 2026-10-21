/**
 * What the request body readers share (customer-body.ts, job-body.ts, line-item-body.ts). A reader returns what it
 * read, or a Refusal: what's wrong, named so the request can be fixed, and the status that says whose it is to fix.
 */

/** 422 for the request itself, 404 for a record it names that doesn't exist, 501 for something the twin doesn't model yet. */
export type Refusal = { status: 404 | 422 | 501; problem: string };

export function refuse(problem: string, status: Refusal["status"] = 422): Refusal {
  return { status, problem };
}

/** The fields of `body` that aren't null: an optional field sent as null reads as one not sent. */
export function withoutNulls(body: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(body).filter(([, value]) => value !== null));
}
