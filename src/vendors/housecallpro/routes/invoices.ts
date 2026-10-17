import type { Hono } from "hono";
import type { Twin } from "../../../core/twin.ts";
import { hcpError } from "../errors.ts";
import type { HcpInvoice, HcpState } from "../types/index.ts";
import { HCP } from "./base.ts";
import { notFound } from "./customers.ts";
import { amountRange, listParam, oneOf, type Test, timeRange } from "./filters.ts";
import { dueAmount, invoiceResponse, invoiceStatus } from "./invoice-response.ts";
import { invoiceNumberOrder, type ListRequest, pageOf, readList, sorted } from "./lists.ts";

/**
 * Invoices. Get Invoices:        https://docs.housecallpro.com/docs/housecall-public-api/65ce9f430d605-get-invoices
 *           Get Invoice by UUID: https://docs.housecallpro.com/docs/housecall-public-api/0ae16219c3e58-get-invoice-by-uuid
 *           Get Job Invoices:    https://docs.housecallpro.com/docs/housecall-public-api/eb1f5b5f17290-get-job-invoices
 */
export function invoiceRoutes(app: Hono, twin: Twin): void {
  const state = () => twin.state<HcpState>("housecallpro");

  app.get(`${HCP}/invoices`, (c) => {
    const list = readList(c.req, { sortable: SORTABLE, sortBy: "created_at", expandable: [] });
    if ("problem" in list) return c.json(hcpError(list.problem), 400);
    const matches = readInvoiceFilter(c.req);
    if ("problem" in matches) return c.json(hcpError(matches.problem), 400);
    const records = sorted([...state().invoices.values()].filter(matches), list.sort, sortValue);
    return c.json(pageOf("invoices", records, list.paging, (invoice) => invoiceResponse(invoice, true)));
  });

  app.get(`${HCP}/api/invoices/:uuid`, (c) => {
    const invoice = state().invoices.get(c.req.param("uuid"));
    return invoice ? c.json(invoiceResponse(invoice, true)) : notFound(c, "invoice");
  });

  // "Lists all invoices for a job", unpaged.
  app.get(`${HCP}/jobs/:id/invoices`, (c) => {
    if (!state().jobs.has(c.req.param("id"))) return notFound(c, "job");
    const ids = state().invoicesByJob.get(c.req.param("id")) ?? [];
    return c.json({ invoices: ids.map((id) => invoiceResponse(state().invoices.get(id)!, false)) });
  });
}

const SORTABLE = ["amount", "created_at", "due_amount", "due_at", "invoice_number", "paid_at", "sent_at", "status", "updated_at"] as const;

function sortValue(invoice: HcpInvoice, by: (typeof SORTABLE)[number]): string | number | null {
  if (by === "amount") return invoiceResponse(invoice, false).amount;
  if (by === "due_amount") return dueAmount(invoice);
  if (by === "status") return invoiceStatus(invoice);
  if (by === "invoice_number") return invoiceNumberOrder(invoice.invoice_number);
  return invoice[by];
}

/**
 * The filters Get Invoices documents: status, customer_uuid, created_at, due_at, and paid_at ranges, amount_due
 * ranges (in cents, like every amount), and payment_method. location_ids is checked for every request (locations.ts).
 */
function readInvoiceFilter(req: ListRequest): Test<HcpInvoice> | { problem: string } {
  const tests: Test<HcpInvoice>[] = [];
  const problem =
    oneOf<HcpInvoice>(req, "status", STATUSES, (invoice) => [invoiceStatus(invoice)], tests) ??
    oneOf<HcpInvoice>(req, "payment_method", PAYMENT_METHODS, (invoice) => invoice.payments.map((p) => p.payment_method), tests) ??
    timeRange<HcpInvoice>(req, "created_at", (invoice) => invoice.created_at, tests) ??
    timeRange<HcpInvoice>(req, "due_at", (invoice) => invoice.due_at, tests) ??
    timeRange<HcpInvoice>(req, "paid_at", (invoice) => invoice.paid_at, tests) ??
    amountRange<HcpInvoice>(req, "amount_due", dueAmount, tests);
  if (problem) return { problem };
  const customers = listParam(req, "customer_uuid");
  if (customers.length) tests.push((invoice) => customers.includes(invoice.customer_id));
  return (invoice) => tests.every((test) => test(invoice));
}

const STATUSES = ["open", "pending_payment", "paid", "voided", "uncollectible", "canceled"];
const PAYMENT_METHODS = ["consumer_financing", "credit_card", "ach", "external", "mobile_check_deposit"];
