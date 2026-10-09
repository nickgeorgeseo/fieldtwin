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
  BillAddr?: QboPhysicalAddress;
  Active: boolean;
  MetaData: QboMetaData;
}

export interface QboPhysicalAddress {
  Line1?: string;
  City?: string;
  CountrySubDivisionCode?: string;
  PostalCode?: string;
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

/**
 * Invoice: https://developer.intuit.com/app/developer/qbo/docs/api/accounting/all-entities/invoice
 * The twin models SalesItemLine lines (an Item, a quantity, a price) and the SubTotalLine QuickBooks adds.
 * No sales tax: TxnTaxDetail is not modeled, so TotalAmt is the sum of the lines.
 */
export interface QboInvoice {
  Id: string;
  SyncToken: string;
  DocNumber?: string; // at most 21 characters
  TxnDate: string; // YYYY-MM-DD
  DueDate: string;
  CustomerRef: QboRef;
  Line: QboInvoiceLine[];
  TotalAmt: number; // read only: computed from the lines
  Balance: number; // read only: TotalAmt minus payments applied. 0 means paid in full
  LinkedTxn: QboLinkedTxn[]; // read only: the payments applied to this invoice
  BillAddr?: QboPhysicalAddress;
  BillEmail?: { Address: string };
  CustomerMemo?: { value: string };
  PrivateNote?: string;
  MetaData: QboMetaData;
}

export interface QboSalesItemLine {
  Id: string;
  LineNum: number;
  Description?: string;
  Amount: number;
  DetailType: "SalesItemLineDetail";
  SalesItemLineDetail: { ItemRef: QboRef; Qty?: number; UnitPrice?: number; ServiceDate?: string };
}

export interface QboSubTotalLine {
  Amount: number;
  DetailType: "SubTotalLineDetail";
  SubTotalLineDetail: Record<string, never>;
}

export type QboInvoiceLine = QboSalesItemLine | QboSubTotalLine;

/** A link to a related transaction. On an invoice, payments appear here with TxnType "Payment". */
export interface QboLinkedTxn {
  TxnId: string;
  TxnType: "Payment" | "Invoice";
}

export const WRITABLE_INVOICE_FIELDS = [
  "CustomerRef",
  "Line",
  "DocNumber",
  "TxnDate",
  "DueDate",
  "BillAddr",
  "BillEmail",
  "CustomerMemo",
  "PrivateNote",
] as const;

/** The entities the twin serves. Each has its own Id sequence. */
export type QboEntityName = "Customer" | "Item" | "Invoice";

export interface QboState {
  realmId: string;
  customers: Map<string, QboCustomer>;
  items: Map<string, QboItem>;
  invoices: Map<string, QboInvoice>;
  nextId: Record<QboEntityName, number>;
}
