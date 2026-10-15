import { describe, expect, it } from "vitest";
import { createCheckpoint, rewindTo, runAction } from "../src/control/operations.ts";
import { setup } from "./helpers.ts";

/** Invoice: https://developer.getjobber.com/docs (Important Objects: Invoice) */

type Harness = ReturnType<typeof setup>;
const data = async (harness: Harness, query: string, variables?: Record<string, unknown>) => {
  const body = await (await harness.jobber(query, variables)).json();
  if (body.errors) throw new Error(JSON.stringify(body.errors));
  return body.data;
};
const totalOf = (lines: { quantity: number; unitPrice: number }[]) =>
  Math.round(lines.reduce((sum, line) => sum + line.quantity * line.unitPrice, 0) * 100) / 100;

interface InvoiceRow {
  invoiceNumber: string;
  invoiceStatus: string;
  issuedDate: string;
  dueDate: string;
  amounts: { subtotal: number; total: number; paymentsTotal: number; invoiceBalance: number };
}

const INVOICES = `{ invoices(first: 50) { totalCount nodes {
  id invoiceNumber invoiceStatus subject issuedDate dueDate
  amounts { subtotal total paymentsTotal invoiceBalance }
  client { name }
} } }`;

describe("Jobber twin: invoices", () => {
  it("lists invoices in number order with documented fields and amounts that add up", async () => {
    const harness = setup();
    const { invoices } = await data(harness, INVOICES);
    const history = harness.twin.world.history.invoices;
    expect(invoices.totalCount).toBe(history.length);

    invoices.nodes.forEach((invoice: InvoiceRow, index: number) => {
      const world = history[index]!;
      const total = totalOf(world.lineItems);
      expect(invoice).toMatchObject({ invoiceNumber: String(world.number), issuedDate: world.issuedAt, dueDate: world.dueAt });
      expect(invoice.amounts.total).toBe(total);
      expect(invoice.amounts.subtotal).toBe(total);
      if (world.paidAt) {
        expect(invoice.invoiceStatus).toBe("paid");
        expect(invoice.amounts).toMatchObject({ paymentsTotal: total, invoiceBalance: 0 });
      } else {
        expect(["awaiting_payment", "past_due"]).toContain(invoice.invoiceStatus);
        expect(invoice.amounts).toMatchObject({ paymentsTotal: 0, invoiceBalance: total });
      }
    });
    const statuses = new Set(invoices.nodes.map((invoice: { invoiceStatus: string }) => invoice.invoiceStatus));
    expect(statuses).toEqual(new Set(["paid", "awaiting_payment", "past_due"]));
  });

  it("turns an open invoice past_due once its due date passes in twin time, with no events recorded", async () => {
    const harness = setup();
    const { invoices } = await data(harness, INVOICES);
    const open = invoices.nodes.find((invoice: { invoiceStatus: string }) => invoice.invoiceStatus === "awaiting_payment");
    const before = harness.twin.log.length;

    harness.twin.clock.advance(Date.parse(open.dueDate) + 2 * 86_400_000 - harness.twin.clock.nowMs());
    const { invoice } = await data(harness, "query ($id: EncodedId!) { invoice(id: $id) { invoiceStatus } }", { id: open.id });
    expect(invoice.invoiceStatus).toBe("past_due");
    expect(harness.twin.log.length).toBe(before);
  });

  it("links an invoice to the job it bills, with its line items", async () => {
    const harness = setup();
    const { invoices } = await data(harness, "{ invoices(first: 1) { nodes { id } } }");
    const { invoice } = await data(
      harness,
      `query ($id: EncodedId!) { invoice(id: $id) {
        jobs(first: 2) { nodes { jobNumber jobStatus invoicedTotal uninvoicedTotal total invoices(first: 2) { nodes { invoiceNumber } } } }
        lineItems(first: 5) { nodes { name quantity unitPrice totalPrice } }
      } }`,
      { id: invoices.nodes[0].id },
    );
    const world = harness.twin.world.history.invoices[0]!;
    const job = harness.twin.world.history.jobs.find((candidate) => candidate.key === world.jobKey)!;
    expect(invoice.jobs.nodes).toEqual([
      {
        jobNumber: job.number,
        jobStatus: "archived", // finished and invoiced
        invoicedTotal: totalOf(job.lineItems),
        uninvoicedTotal: 0,
        total: totalOf(job.lineItems),
        invoices: { nodes: [{ invoiceNumber: "1" }] },
      },
    ]);
    expect(invoice.lineItems.nodes.map((line: { name: string }) => line.name)).toEqual(world.lineItems.map((line) => line.name));
  });

  it("shows what each client owes as their balance, and lists their invoices", async () => {
    const harness = setup();
    const { clients } = await data(
      harness,
      "{ clients(first: 30) { nodes { balance invoices(first: 20) { nodes { amounts { invoiceBalance } } } } } }",
    );
    for (const client of clients.nodes) {
      const owed = client.invoices.nodes.reduce(
        (sum: number, invoice: { amounts: { invoiceBalance: number } }) => sum + invoice.amounts.invoiceBalance,
        0,
      );
      expect(client.balance).toBeCloseTo(owed, 2);
    }
    expect(clients.nodes.some((client: { balance: number }) => client.balance > 0)).toBe(true);
  });

  it("shows a payment at once wherever its invoice appears, and a rewind's undoing of it too", async () => {
    const harness = setup();
    type Read = { id: string; invoiceStatus: string };
    type ClientRead = { id: string; balance: number; invoices: { nodes: Read[] }; jobs: { nodes: { invoices: { nodes: Read[] } }[] } };
    const read = async (): Promise<ClientRead[]> =>
      (
        await data(
          harness,
          `{ clients(first: 25) { nodes { id balance invoices(first: 20) { nodes { id invoiceStatus } }
            jobs(first: 20) { nodes { invoices(first: 5) { nodes { id invoiceStatus } } } } } } }`,
        )
      ).clients.nodes;
    const statuses = (reads: Read[]) => Object.fromEntries(reads.map((invoice) => [invoice.id, invoice.invoiceStatus]));
    const byClient = (clients: ClientRead[]) => statuses(clients.flatMap((client) => client.invoices.nodes));
    const byJob = (clients: ClientRead[]) => statuses(clients.flatMap((client) => client.jobs.nodes.flatMap((job) => job.invoices.nodes)));

    const before = await read();
    createCheckpoint(harness.twin, "before");
    await runAction(harness.twin, "jobber", "payInvoices", 1);
    const after = await read();
    const [paid, ...others] = Object.keys(byClient(after)).filter(
      (id) => byClient(after)[id] === "paid" && byClient(before)[id] !== "paid",
    );
    expect(others).toEqual([]);
    expect(byJob(after)[paid!]).toBe("paid");
    const owner = (clients: ClientRead[]) => clients.find((client) => client.invoices.nodes.some((invoice) => invoice.id === paid))!;
    expect(owner(after).balance).toBeLessThan(owner(before).balance);

    rewindTo(harness.twin, "before");
    expect(await read()).toEqual(before);
  });

  it("marks finished work that hasn't been invoiced yet as requires_invoicing", async () => {
    const harness = setup();
    const { invoices, jobs } = harness.twin.world.history;
    const uninvoiced = jobs.find((job) => job.visits.every((visit) => visit.completedAt) && !invoices.some((i) => i.jobKey === job.key))!;
    const id = Buffer.from(`gid://Jobber/Job/${uninvoiced.number}`).toString("base64");
    const { job } = await data(harness, "query ($id: EncodedId!) { job(id: $id) { jobStatus uninvoicedTotal total } }", { id });
    expect(job.jobStatus).toBe("requires_invoicing");
    expect(job.uninvoicedTotal).toBe(job.total);
  });
});
