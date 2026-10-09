import type { QboFault } from "../errors.ts";
import { qboErrors } from "../errors.ts";
import type { QboEntityName, QboState } from "../types.ts";

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

/**
 * How an entity looks in a response. Every documented sample carries `"domain": "QBO"` and `"sparse": false`;
 * they describe the response, not the business, so they are added here and never stored in the event log.
 */
export function asResponse<T extends object>(entity: T): T & { domain: "QBO"; sparse: false } {
  return { ...entity, domain: "QBO", sparse: false };
}

/** Every entity the twin serves, by its QuickBooks name, with where its records live. */
export const ENTITY_RECORDS: Record<QboEntityName, (state: QboState) => Map<string, Versioned>> = {
  Customer: (state) => state.customers,
  Item: (state) => state.items,
  Invoice: (state) => state.invoices,
  Payment: (state) => state.payments,
};

/** The canonical entity name for one written in any case ("invoice" -> "Invoice"), or undefined. */
export function entityNamed(name: string): QboEntityName | undefined {
  return (Object.keys(ENTITY_RECORDS) as QboEntityName[]).find((entity) => entity.toLowerCase() === name.trim().toLowerCase());
}
