/**
 * QuickBooks Online record shapes, named exactly as the public API names them
 * (PascalCase fields, string Ids, string SyncTokens). Only the fields the twin supports are listed.
 * Entity reference: https://developer.intuit.com/app/developer/qbo/docs/api/accounting/all-entities/customer
 */

/** Created and updated times. Set by QuickBooks, read only for apps. */
export interface QboMetaData {
  CreateTime: string;
  LastUpdatedTime: string;
}

/** A reference to another entity: its Id in `value`, and its display name in `name`. */
export interface QboRef {
  value: string;
  name?: string;
}

/** Customer: https://developer.intuit.com/app/developer/qbo/docs/api/accounting/all-entities/customer */
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
  MetaData: QboMetaData;
}

/** Fields a caller is allowed to send. Id, SyncToken, and MetaData are managed by QuickBooks. */
export const WRITABLE_CUSTOMER_FIELDS = [
  "DisplayName",
  "GivenName",
  "FamilyName",
  "PrimaryEmailAddr",
  "PrimaryPhone",
  "BillAddr",
  "Active",
] as const;

/**
 * Item: https://developer.intuit.com/app/developer/qbo/docs/api/accounting/all-entities/item
 * The twin models Service and NonInventory items. Inventory items need asset accounts and quantities on
 * hand, which the twin doesn't model, and the twin's items are flat (no categories or sub-items).
 */
export interface QboItem {
  Id: string;
  SyncToken: string;
  Name: string; // unique, at most 100 characters, no colons, tabs, or newlines
  FullyQualifiedName: string; // read only: the Name, prefixed by any parents (the twin's items have none)
  Type: "Service" | "NonInventory";
  Description?: string;
  UnitPrice: number;
  Taxable: boolean;
  TrackQtyOnHand: boolean;
  Active: boolean;
  MetaData: QboMetaData;
}

/** The entities the twin serves. Each has its own Id sequence. */
export type QboEntityName = "Customer" | "Item";

export interface QboState {
  realmId: string;
  customers: Map<string, QboCustomer>;
  items: Map<string, QboItem>;
  nextId: Record<QboEntityName, number>;
}
