import type { TwinEvent } from "./twin-types.ts";

/**
 * Both vendors' records as they stand now, rebuilt from the event log. Every "...Created" and "...Updated" event
 * carries the whole record (src/vendors/<vendor>/events.ts), so the last one for an Id is the record now. Reading
 * the log changes nothing in the twin: reading through the vendor APIs would spend their rate limits and draw from
 * the seeded faults your own code meets.
 */

export interface QboCustomer {
  Id: string;
  DisplayName: string;
  Active?: boolean;
  PrimaryEmailAddr?: { Address?: string };
}

export interface QboInvoice {
  Id: string;
  DocNumber?: string;
  CustomerRef: { value: string; name?: string };
  TotalAmt: number;
  Balance: number;
}

export interface JobberClient {
  id: string;
  firstName: string | null;
  lastName: string | null;
  companyName: string | null;
  emails: { address: string; primary: boolean }[];
}

export interface JobberInvoice {
  id: string;
  invoiceNumber: string;
  clientId: string;
  subject: string;
  lineItems: { totalPrice: number }[];
  paidAt: string | null;
}

export interface Books {
  quickbooks: { customers: QboCustomer[]; invoices: QboInvoice[] };
  jobber: { clients: JobberClient[]; invoices: JobberInvoice[] };
}

export function readBooks(events: TwinEvent[]): Books {
  const records = latestRecords(events);
  const all = <T>(vendor: string, kind: string) => [...(records.get(`${vendor}:${kind}`)?.values() ?? [])] as T[];
  return {
    quickbooks: { customers: all<QboCustomer>("quickbooks", "customer"), invoices: all<QboInvoice>("quickbooks", "invoice") },
    jobber: { clients: all<JobberClient>("jobber", "client"), invoices: all<JobberInvoice>("jobber", "invoice") },
  };
}

/**
 * A Housecall Pro line in cents, as the twin works it out (src/vendors/housecallpro/amounts.ts): the quantity, counted
 * in hundredths, times the unit price in cents, to the nearest cent, half a cent up. Multiplying the quantity as it is
 * would round some half cents down: 2.01 × 3450 is 6934.4999... in floating point.
 */
export function hcpLineCents({ quantity, unit_price }: { quantity: number; unit_price: number }): number {
  return Math.round((Math.round(quantity * 100) * unit_price) / 100);
}

/** "quickbooks:customer" → Id → the customer as its latest event left it. */
function latestRecords(events: TwinEvent[]): Map<string, Map<string, unknown>> {
  const records = new Map<string, Map<string, unknown>>();
  for (const { vendor, type, data } of events) {
    const kind = /^([A-Z]\w*?)(Created|Updated)$/.exec(type)?.[1];
    if (!kind || typeof data !== "object" || data === null) continue;
    const key = kind.charAt(0).toLowerCase() + kind.slice(1);
    const record = (data as Record<string, unknown>)[key];
    if (typeof record !== "object" || record === null) continue;
    const { Id, id } = record as { Id?: unknown; id?: unknown };
    const recordId = String(Id ?? id ?? "");
    if (!recordId) continue;
    const byId = records.get(`${vendor}:${key}`) ?? new Map<string, unknown>();
    byId.set(recordId, record);
    records.set(`${vendor}:${key}`, byId);
  }
  return records;
}
