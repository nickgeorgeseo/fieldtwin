import type { QboFault } from "../errors.ts";
import { qboErrors } from "../errors.ts";

/**
 * What every QuickBooks entity route shares: the company path, the SyncToken rule, and sparse vs full updates.
 * https://developer.intuit.com/app/developer/qbo/docs/learn/rest-api-features
 */

/** Every QuickBooks URL names a company ("realm"): /v3/company/{realmId}/{entity} */
export const COMPANY = "/v3/company/:realmId";

export interface Versioned {
  Id: string;
  SyncToken: string;
  MetaData: { CreateTime: string; LastUpdatedTime: string };
}

/** What a client sends to update an entity: its Id, the SyncToken it last read, and `sparse`. */
export type UpdateBody<T> = Partial<T> & { Id?: string; SyncToken?: string; sparse?: boolean };

/**
 * The quirk that breaks real integrations: you must send the SyncToken you last read.
 * If anyone changed the record since then, QuickBooks rejects the update with 5010.
 */
export function checkSyncToken(existing: Versioned, body: UpdateBody<unknown>, now: string): QboFault | undefined {
  if (body.SyncToken === undefined) return qboErrors.missingField("SyncToken", now);
  if (String(body.SyncToken) !== existing.SyncToken) return qboErrors.staleObject(now);
  return undefined;
}

/**
 * The writable fields after an update. A sparse update changes only the fields you send. A full update
 * replaces every writable field, so anything you leave out is cleared. Getting this wrong silently wipes
 * data in production, which is exactly why the twin models it.
 */
export function mergeUpdate<T extends object>(existing: T, body: UpdateBody<T>, writable: readonly (keyof T)[]): Partial<T> {
  const base = body.sparse ? pickWritable(existing, writable) : {};
  return { ...base, ...pickWritable(body as Partial<T>, writable) };
}

/** Only the fields a caller may set. Read-only fields in a request are "silently overwritten", as documented. */
export function pickWritable<T extends object>(source: Partial<T>, writable: readonly (keyof T)[]): Partial<T> {
  const picked: Partial<T> = {};
  for (const field of writable) {
    if (source[field] !== undefined) picked[field] = source[field];
  }
  return picked;
}

/** The system-managed fields of the next version of a record. */
export function nextVersion(existing: Versioned, now: string): Versioned {
  return {
    Id: existing.Id,
    SyncToken: String(Number(existing.SyncToken) + 1),
    MetaData: { CreateTime: existing.MetaData.CreateTime, LastUpdatedTime: now },
  };
}
