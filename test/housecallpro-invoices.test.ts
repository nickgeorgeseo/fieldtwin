import { describe, expect, it } from "vitest";
import type { WorldInvoice } from "../src/world/history.ts";
import { setup } from "./helpers.ts";

type Harness = ReturnType<typeof setup>;

/** The parts of an invoice these tests read. */
interface Invoice {
  id: string;
  job_id: string;
  status: string;
  invoice_number: string;
  amount: number;
  subtotal: number;
  due_amount: number;
  due_at: string;
  paid_at: string | null;
  invoice_date: string;
  items: { amount: number; qty_in_hundredths: number; type: string }[];
  payments: { amount: number; status: string; payment_method: string }[];
}

const cents = (invoice: WorldInvoice) =>
  invoice.lineItems.reduce((total, line) => total + Math.round(line.quantity * line.unitPrice * 100), 0);
const iso = (time: string) => time.replace(".000Z", "Z");

async function allInvoices(harness: Harness, query = ""): Promise<Invoice[]> {
  return (await (await harness.hcpGet(`/invoices?page_size=1000${query}`)).json()).invoices;
}

/** The twin's invoice for a world invoice: it has the world's invoice number, as the books and Jobber do. */
async function invoiceFor(harness: Harness, worldInvoice: WorldInvoice): Promise<Invoice> {
  return (await allInvoices(harness)).find((invoice) => invoice.invoice_number === String(worldInvoice.number))!;
}

const paidInvoice = (harness: Harness) => harness.twin.world.history.invoices.find((invoice) => invoice.paidAt)!;
const unpaidInvoice = (harness: Harness) => harness.twin.world.history.invoices.find((invoice) => !invoice.paidAt)!;

describe("Housecall Pro twin: invoices", () => {
  it("lists the business's invoices, newest first, with the page counts", async () => {
    const harness = setup();
    const body = await (await harness.hcpGet("/invoices")).json();
    const total = harness.twin.world.history.invoices.length;
    expect(body).toMatchObject({ page: 1, page_size: 10, total_items: total, total_pages: Math.ceil(total / 10) });
    expect(body.invoices[0].id).toMatch(/^invoice_[0-9a-f]{32}$/);
    const dates = (await allInvoices(harness)).map((invoice) => invoice.invoice_date); // issued when created
    expect(dates).toEqual([...dates].sort().reverse());
  });

  it("marks a paid invoice paid, with its payment, in cents", async () => {
    const harness = setup();
    const world = paidInvoice(harness);
    const invoice = await invoiceFor(harness, world);
    expect(invoice).toMatchObject({
      status: "paid",
      amount: cents(world),
      subtotal: cents(world),
      due_amount: 0,
      paid_at: iso(world.paidAt!),
    });
    expect(invoice.due_at).toBe(iso(world.dueAt));
    expect(invoice.payments).toEqual([expect.objectContaining({ amount: cents(world), status: "succeeded", paid_at: iso(world.paidAt!) })]);
    expect(invoice.items.reduce((total, item) => total + item.amount, 0)).toBe(cents(world));
    expect(invoice.items[0]).toMatchObject({ qty_in_hundredths: world.lineItems[0]!.quantity * 100, type: "labor" });
  });

  it("leaves an unpaid invoice open, with all of it due", async () => {
    const harness = setup();
    const world = unpaidInvoice(harness);
    const invoice = await invoiceFor(harness, world);
    expect(invoice).toMatchObject({ status: "open", due_amount: cents(world), paid_at: null, payments: [] });
  });

  it("filters invoices by status, customer, dates, and amount due", async () => {
    const harness = setup();
    const { invoices } = harness.twin.world.history;
    expect(await allInvoices(harness, "&status[]=paid")).toHaveLength(invoices.filter((invoice) => invoice.paidAt).length);
    expect(await allInvoices(harness, "&status[]=open&status[]=paid")).toHaveLength(invoices.length);

    const sample = await invoiceFor(harness, unpaidInvoice(harness));
    const job = await (await harness.hcpGet(`/jobs/${sample.job_id}`)).json();
    const forCustomer = await allInvoices(harness, `&customer_uuid[]=${job.customer.id}`);
    expect(forCustomer.map((invoice) => invoice.id)).toContain(sample.id);
    expect(forCustomer.length).toBe(invoices.filter((invoice) => invoice.customerKey === unpaidInvoice(harness).customerKey).length);

    const dueSoon = await allInvoices(harness, `&due_at_min=${sample.due_at}&due_at_max=${sample.due_at}`);
    expect(dueSoon.every((invoice) => invoice.due_at === sample.due_at)).toBe(true);
    const owing = await allInvoices(harness, `&amount_due_min=${sample.due_amount}`);
    expect(owing.every((invoice) => invoice.due_amount >= sample.due_amount)).toBe(true);
    expect(owing.map((invoice) => invoice.id)).toContain(sample.id);
    const paidSince = await allInvoices(harness, "&paid_at_min=2026-07-01");
    expect(paidSince.every((invoice) => invoice.paid_at! >= "2026-07-01")).toBe(true);
  });

  it("filters invoices by payment method: the world's payments are external, and a method it doesn't document is refused", async () => {
    const harness = setup();
    const paid = harness.twin.world.history.invoices.filter((invoice) => invoice.paidAt);
    const external = await allInvoices(harness, "&payment_method[]=external");
    expect(external).toHaveLength(paid.length);
    expect(external.every((invoice) => invoice.payments.some((payment) => payment.payment_method === "external"))).toBe(true);
    expect(await allInvoices(harness, "&payment_method[]=credit_card")).toEqual([]);

    const response = await harness.hcpGet("/invoices?payment_method[]=cash");
    expect(response.status).toBe(400);
    expect((await response.json()).error.message).toBe(
      'payment_method takes consumer_financing, credit_card, ach, external, mobile_check_deposit, not "cash".',
    );
  });

  it("filters invoices by when they were created, and by the amount still due", async () => {
    const harness = setup();
    const all = await allInvoices(harness);
    const dates = all.map((invoice) => invoice.invoice_date).sort();
    const [min, max] = [dates[Math.floor(dates.length / 3)]!, dates[Math.floor((2 * dates.length) / 3)]!];
    const between = await allInvoices(harness, `&created_at_min=${min}&created_at_max=${max}`);
    expect(between.length).toBeGreaterThan(0);
    expect(between.length).toBeLessThan(all.length);
    expect(between.every((invoice) => invoice.invoice_date >= min && invoice.invoice_date <= max)).toBe(true);

    const settled = await allInvoices(harness, "&amount_due_max=0");
    expect(settled).toHaveLength(harness.twin.world.history.invoices.filter((invoice) => invoice.paidAt).length);
    expect(settled.every((invoice) => invoice.status === "paid" && invoice.due_amount === 0)).toBe(true);

    const response = await harness.hcpGet("/invoices?amount_due_min=lots");
    expect(response.status).toBe(400);
    expect((await response.json()).error.message).toBe('amount_due_min must be an amount in cents, like 15000, not "lots".');
  });

  it("ignores an empty customer_uuid[], as Rails sends an empty list, the way the other filters ignore empties", async () => {
    const harness = setup();
    expect(await allInvoices(harness, "&customer_uuid[]=")).toHaveLength(harness.twin.world.history.invoices.length);
  });

  it("sorts invoices by invoice_number as numbers, so 2 comes before 10", async () => {
    const harness = setup();
    const numbers = (await allInvoices(harness, "&sort_by=invoice_number&sort_direction=asc")).map((invoice) =>
      Number(invoice.invoice_number),
    );
    expect(numbers).toEqual([...numbers].sort((a, b) => a - b));
  });

  it("sorts invoices by amount when asked, and refuses a status it doesn't know", async () => {
    const harness = setup();
    const amounts = (await allInvoices(harness, "&sort_by=amount&sort_direction=asc")).map((invoice) => invoice.amount);
    expect(amounts).toEqual([...amounts].sort((a, b) => a - b));
    const response = await harness.hcpGet("/invoices?status[]=settled");
    expect(response.status).toBe(400);
    expect((await response.json()).error.message).toMatch(/open, pending_payment, paid, voided, uncollectible, canceled/);
  });

  it("reads one invoice at /api/invoices/{uuid}, with its job's id", async () => {
    const harness = setup();
    const listed = await invoiceFor(harness, paidInvoice(harness));
    const response = await harness.hcpGet(`/api/invoices/${listed.id}`);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(listed);
    const missing = await harness.hcpGet("/api/invoices/invoice_missing");
    expect(missing.status).toBe(404);
    expect(await missing.json()).toEqual({ error: { message: "invoice not found" } });
  });
});

describe("Housecall Pro twin: invoices and the books", () => {
  it("numbers each invoice as the books do, so a sync finds it in QuickBooks by number, or finds it missing", async () => {
    const harness = setup();
    let found = 0;
    for (const invoice of await allInvoices(harness)) {
      const query = encodeURIComponent(`select * from Invoice where DocNumber = '${invoice.invoice_number}'`);
      const [booked] = (await (await harness.qboGet(`/query?query=${query}`)).json()).QueryResponse.Invoice ?? [];
      if (!booked) continue; // issued too recently for the bookkeeper (the books run two weeks behind)
      found++;
      expect(Math.round(booked.TotalAmt * 100), invoice.invoice_number).toBe(invoice.amount);
    }
    expect(found).toBeGreaterThan(0);
  });
});

describe("Housecall Pro twin: a job's invoices", () => {
  it("lists a job's invoices, and none for finished work not invoiced yet", async () => {
    const harness = setup();
    const invoiced = await invoiceFor(harness, paidInvoice(harness));
    const { invoices } = await (await harness.hcpGet(`/jobs/${invoiced.job_id}/invoices`)).json();
    const { job_id: _, ...withoutJobId } = invoiced;
    expect(invoices).toEqual([withoutJobId]);

    const { jobs, invoices: worldInvoices } = harness.twin.world.history;
    const waiting = jobs.find((job) => job.visits.every((visit) => visit.completedAt) && !worldInvoices.some((i) => i.jobKey === job.key))!;
    const all = (await (await harness.hcpGet("/jobs?page_size=1000")).json()).jobs as {
      id: string;
      schedule: { scheduled_start: string };
    }[];
    const job = all.find((candidate) => candidate.schedule.scheduled_start === waiting.visits[0]!.startAt.replace(".000Z", "Z"))!;
    expect((await (await harness.hcpGet(`/jobs/${job.id}/invoices`)).json()).invoices).toEqual([]);
  });

  it("shows nothing still owed on a job once its invoice is paid, and the whole total before", async () => {
    const harness = setup();
    const paid = await invoiceFor(harness, paidInvoice(harness));
    expect((await (await harness.hcpGet(`/jobs/${paid.job_id}`)).json()).outstanding_balance).toBe(0);
    const unpaid = await invoiceFor(harness, unpaidInvoice(harness));
    const job = await (await harness.hcpGet(`/jobs/${unpaid.job_id}`)).json();
    expect(job.outstanding_balance).toBe(job.total_amount);
  });
});
