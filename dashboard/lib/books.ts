import type { TwinEvent } from "./twin-types.ts";

/**
 * Every vendor's records as they stand now, rebuilt from the event log. Every "...Created" and "...Updated" event
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

export interface HcpCustomer {
  id: string;
  first_name: string | null;
  last_name: string | null;
  company: string | null;
  email: string | null;
  mobile_number: string | null;
  home_number: string | null;
  work_number: string | null;
}

export interface HcpInvoice {
  id: string;
  invoice_number: string; // the job's number too (FIDELITY.md); the books carry it as DocNumber, as they carry Jobber's
  customer_id: string;
  items: { unit_price: number; quantity: number }[]; // unit prices in cents
  paid_at: string | null;
}

export interface Books {
  quickbooks: { customers: QboCustomer[]; invoices: QboInvoice[] };
  jobber: { clients: JobberClient[]; invoices: JobberInvoice[] };
  housecallpro: { customers: HcpCustomer[]; invoices: HcpInvoice[] };
}

export function readBooks(events: TwinEvent[]): Books {
  const records = latestRecords(events);
  const all = <T>(vendor: string, kind: string) => [...(records.get(`${vendor}:${kind}`)?.values() ?? [])] as T[];
  const qboCustomers = all<QboCustomer>("quickbooks", "customer");
  return {
    quickbooks: { customers: qboCustomers, invoices: withCurrentNames(all<QboInvoice>("quickbooks", "invoice"), qboCustomers) },
    jobber: { clients: all<JobberClient>("jobber", "client"), invoices: all<JobberInvoice>("jobber", "invoice") },
    housecallpro: { customers: all<HcpCustomer>("housecallpro", "customer"), invoices: all<HcpInvoice>("housecallpro", "invoice") },
  };
}

/**
 * QuickBooks refers to a customer by Id, so an invoice shows its customer's current name. A rename records only the
 * CustomerUpdated event, not one per invoice, so the name comes from the customer, as the twin's own state does it
 * (src/vendors/quickbooks/state.ts, renameReferences).
 */
function withCurrentNames(invoices: QboInvoice[], customers: QboCustomer[]): QboInvoice[] {
  const names = new Map(customers.map((customer) => [customer.Id, customer.DisplayName]));
  return invoices.map((invoice) => {
    const name = names.get(invoice.CustomerRef.value);
    return name === undefined || name === invoice.CustomerRef.name
      ? invoice
      : { ...invoice, CustomerRef: { ...invoice.CustomerRef, name } };
  });
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
