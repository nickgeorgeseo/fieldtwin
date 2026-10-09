import { type QuickBooksClient, QuickBooksError, quoted } from "./quickbooks.ts";

/**
 * The QuickBooks records the sync reads and writes, with only the fields it uses, named as the API names them.
 * Customer: https://developer.intuit.com/app/developer/qbo/docs/api/accounting/all-entities/customer
 * Item:     https://developer.intuit.com/app/developer/qbo/docs/api/accounting/all-entities/item
 * Invoice:  https://developer.intuit.com/app/developer/qbo/docs/api/accounting/all-entities/invoice
 * Payment:  https://developer.intuit.com/app/developer/qbo/docs/api/accounting/all-entities/payment
 */

export interface Ref {
  value: string;
  name?: string;
}

export interface Customer {
  Id: string;
  SyncToken: string;
  DisplayName: string;
  PrimaryEmailAddr?: { Address: string };
}

export interface NewCustomer {
  DisplayName: string;
  GivenName?: string;
  FamilyName?: string;
  CompanyName?: string;
  PrimaryEmailAddr?: { Address: string };
}

export interface Item {
  Id: string;
  Name: string;
  Type: string;
}

export interface SalesLine {
  DetailType: "SalesItemLineDetail";
  Amount: number;
  Description?: string;
  SalesItemLineDetail: { ItemRef: Ref; Qty?: number; UnitPrice?: number };
}

export interface Invoice {
  Id: string;
  SyncToken: string;
  DocNumber?: string;
  CustomerRef: Ref;
  TotalAmt: number;
  Balance: number; // 0 means paid in full
  PrivateNote?: string;
}

export interface NewInvoice {
  CustomerRef: Ref;
  DocNumber: string;
  TxnDate?: string; // YYYY-MM-DD
  DueDate?: string;
  BillEmail?: { Address: string };
  Line: SalesLine[];
}

export interface Payment {
  Id: string;
  TotalAmt: number;
  PaymentRefNum?: string;
}

export interface NewPayment {
  CustomerRef: Ref;
  TotalAmt: number;
  PaymentRefNum: string;
  Line: { Amount: number; LinkedTxn: { TxnId: string; TxnType: "Invoice" }[] }[];
}

export async function findCustomerByEmail(qbo: QuickBooksClient, email: string): Promise<Customer | undefined> {
  const [customer] = await qbo.query<Customer>("Customer", `WHERE PrimaryEmailAddr = ${quoted(email)}`);
  return customer;
}

export async function findCustomerByName(qbo: QuickBooksClient, displayName: string): Promise<Customer | undefined> {
  const [customer] = await qbo.query<Customer>("Customer", `WHERE DisplayName = ${quoted(displayName)}`);
  return customer;
}

/**
 * Creates a customer. DisplayName must be unique (6240, Duplicate Name Exists), and two people can share a
 * name, so a taken name is retried once as "Name (email)", which says who this one is.
 */
export async function createCustomer(qbo: QuickBooksClient, customer: NewCustomer): Promise<Customer> {
  try {
    return await qbo.write<Customer>("Customer", customer);
  } catch (error) {
    const email = customer.PrimaryEmailAddr?.Address;
    if (!(error instanceof QuickBooksError && error.code === "6240" && email)) throw error;
    return qbo.write<Customer>("Customer", { ...customer, DisplayName: `${customer.DisplayName} (${email})` });
  }
}

/**
 * The Item to book a line to: the one with the line's name, or, if the books have none, the first Service item,
 * with a warning so a bookkeeper can tidy up. Booking to a stand-in keeps the invoice's total right.
 */
export async function itemForLine(qbo: QuickBooksClient, name: string, warn: (line: string) => void): Promise<Item> {
  const [named] = await qbo.query<Item>("Item", `WHERE Name = ${quoted(name)}`);
  if (named) return named;
  const [service] = await qbo.query<Item>("Item", "WHERE Type = 'Service' MAXRESULTS 1");
  if (!service) throw new Error(`No QuickBooks Item named "${name}", and no Service item to book it to instead.`);
  warn(`No QuickBooks Item named "${name}"; booking the line to "${service.Name}" instead.`);
  return service;
}

export async function findInvoiceByDocNumber(qbo: QuickBooksClient, docNumber: string): Promise<Invoice | undefined> {
  const [invoice] = await qbo.query<Invoice>("Invoice", `WHERE DocNumber = ${quoted(docNumber)}`);
  return invoice;
}

export function createInvoice(qbo: QuickBooksClient, invoice: NewInvoice): Promise<Invoice> {
  return qbo.write<Invoice>("Invoice", invoice);
}

export function readInvoice(qbo: QuickBooksClient, id: string): Promise<Invoice> {
  return qbo.read<Invoice>("Invoice", id);
}

/** A sparse update: only the fields sent change. A stale SyncToken answers 5010 (Stale Object). */
export function updateInvoice(qbo: QuickBooksClient, changes: Pick<Invoice, "Id" | "SyncToken"> & Partial<Invoice>): Promise<Invoice> {
  return qbo.write<Invoice>("Invoice", { ...changes, sparse: true });
}

export async function findPaymentByRef(qbo: QuickBooksClient, paymentRefNum: string): Promise<Payment | undefined> {
  const [payment] = await qbo.query<Payment>("Payment", `WHERE PaymentRefNum = ${quoted(paymentRefNum)}`);
  return payment;
}

export function createPayment(qbo: QuickBooksClient, payment: NewPayment): Promise<Payment> {
  return qbo.write<Payment>("Payment", payment);
}
