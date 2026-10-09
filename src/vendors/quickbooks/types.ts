/**
 * QuickBooks Online record shapes, named exactly as the public API names them
 * (PascalCase fields, string Ids, string SyncTokens). Only the fields the twin supports are listed.
 * Reference: https://developer.intuit.com/app/developer/qbo/docs/api/accounting/all-entities/customer
 */

export interface QboCustomer {
  Id: string;
  SyncToken: string; // starts at "0" and goes up by one on every update
  DisplayName: string;
  GivenName?: string;
  FamilyName?: string;
  PrimaryEmailAddr?: { Address: string };
  PrimaryPhone?: { FreeFormNumber: string };
  BillAddr?: { Line1?: string; City?: string; CountrySubDivisionCode?: string; PostalCode?: string };
  Active: boolean;
  MetaData: { CreateTime: string; LastUpdatedTime: string };
}

/** Fields a caller is allowed to send. Id, SyncToken, and MetaData are managed by QuickBooks. */
export const WRITABLE_CUSTOMER_FIELDS = [
  "DisplayName", "GivenName", "FamilyName", "PrimaryEmailAddr", "PrimaryPhone", "BillAddr", "Active",
] as const;

export interface QboState {
  realmId: string;
  customers: Map<string, QboCustomer>;
  nextId: number;
}

/** Event payloads for this vendor. The event's `type` tells you which one you have. */
export type QboEventData =
  | { type: "CompanyCreated"; realmId: string }
  | { type: "CustomerCreated"; customer: QboCustomer }
  | { type: "CustomerUpdated"; customer: QboCustomer };
