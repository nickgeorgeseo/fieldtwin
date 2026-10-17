import { describe, expect, it } from "vitest";
import type { WorldQuote } from "../src/world/history.ts";
import { setup } from "./helpers.ts";

type Harness = ReturnType<typeof setup>;

/** The parts of an estimate these tests read. */
interface Estimate {
  id: string;
  estimate_number: string;
  work_status: string;
  customer: { id: string; email: string };
  schedule: { scheduled_start: string | null };
  options: {
    id: string;
    name: string;
    total_amount: number;
    approval_status: string;
    approval_status_updated_at: string | null;
    status: string;
  }[];
}

const cents = (quote: WorldQuote) => quote.lineItems.reduce((total, line) => total + Math.round(line.quantity * line.unitPrice * 100), 0);
const iso = (time: string) => time.replace(".000Z", "Z");

async function allEstimates(harness: Harness, query = ""): Promise<Estimate[]> {
  return (await (await harness.hcpGet(`/estimates?page_size=1000${query}`)).json()).estimates;
}

async function estimateFor(harness: Harness, quote: WorldQuote): Promise<Estimate> {
  return (await allEstimates(harness)).find((estimate) => estimate.estimate_number === String(quote.number))!;
}

describe("Housecall Pro twin: estimates", () => {
  it("lists the business's quotes as estimates, with the page counts", async () => {
    const harness = setup();
    const body = await (await harness.hcpGet("/estimates")).json();
    const total = harness.twin.world.history.quotes.length;
    expect(body).toMatchObject({ page: 1, page_size: 10, total_items: total, total_pages: Math.ceil(total / 10) });
    expect(body.estimates[0].id).toMatch(/^est_[0-9a-f]{32}$/);
  });

  it("shows an approved quote as an approved option that became the job, which points back at it", async () => {
    const harness = setup();
    const quote = harness.twin.world.history.quotes.find((candidate) => candidate.approvedAt)!;
    const estimate = await estimateFor(harness, quote);
    const person = harness.twin.world.customers.find((customer) => customer.key === quote.customerKey)!;
    expect(estimate.customer.email).toBe(person.email);
    expect(estimate.options).toEqual([
      expect.objectContaining({
        name: "Option #1",
        total_amount: cents(quote),
        approval_status: "approved",
        approval_status_updated_at: iso(quote.approvedAt!),
        status: "created job from estimate",
      }),
    ]);

    const job = harness.twin.world.history.jobs.find((candidate) => candidate.key === quote.jobKey)!;
    const jobs = (await (await harness.hcpGet("/jobs?page_size=1000")).json()).jobs as {
      description: string;
      original_estimate_id: string;
    }[];
    const copied = jobs.filter((candidate) => candidate.original_estimate_id === estimate.id);
    expect(copied.map((candidate) => candidate.description)).toEqual([job.title]);
  });

  it("shows a quote the customer hasn't answered as awaiting a response since it was sent", async () => {
    const harness = setup();
    const quote = harness.twin.world.history.quotes.find((candidate) => !candidate.approvedAt)!;
    const estimate = await estimateFor(harness, quote);
    expect(estimate.options[0]).toMatchObject({
      approval_status: "awaiting response",
      approval_status_updated_at: iso(quote.sentAt),
      status: "open",
    });
  });

  it("shows estimates as never scheduled, since the world's quotes had no site visit", async () => {
    const harness = setup();
    const estimates = await allEstimates(harness);
    expect(estimates.every((estimate) => estimate.work_status === "needs scheduling" && estimate.schedule.scheduled_start === null)).toBe(
      true,
    );
    expect(await allEstimates(harness, "&work_status[]=unscheduled")).toHaveLength(estimates.length);
    expect(await allEstimates(harness, "&work_status[]=scheduled")).toEqual([]);
    expect(await allEstimates(harness, "&scheduled_start_min=2020-01-01")).toEqual([]);
  });

  it("filters estimates by customer", async () => {
    const harness = setup();
    const [sample] = await allEstimates(harness);
    const forCustomer = await allEstimates(harness, `&customer_id=${sample!.customer.id}`);
    expect(forCustomer.map((estimate) => estimate.id)).toContain(sample!.id);
    expect(forCustomer.every((estimate) => estimate.customer.id === sample!.customer.id)).toBe(true);
  });

  it("reads one estimate by id, and its option's line items in cents", async () => {
    const harness = setup();
    const quote = harness.twin.world.history.quotes[0]!;
    const listed = await estimateFor(harness, quote);
    expect(await (await harness.hcpGet(`/estimates/${listed.id}`)).json()).toEqual(listed);

    const option = listed.options[0]!;
    const body = await (await harness.hcpGet(`/estimates/${listed.id}/options/${option.id}/line_items`)).json();
    expect(body).toMatchObject({ page: 1, total_items: quote.lineItems.length });
    expect(body.line_items[0]).toMatchObject({
      name: quote.lineItems[0]!.name,
      unit_price: Math.round(quote.lineItems[0]!.unitPrice * 100),
    });
  });

  it("pages an option's line items with page and page_size, the only parameters that list documents", async () => {
    const harness = setup();
    const estimate = (await allEstimates(harness)).find((candidate) => candidate.options.length)!;
    const path = `/estimates/${estimate.id}/options/${estimate.options[0]!.id}/line_items`;
    const all = (await (await harness.hcpGet(path)).json()).line_items;
    const first = await (await harness.hcpGet(`${path}?page_size=1&sort_by=name&sort_direction=asc`)).json();
    expect(first).toMatchObject({ page: 1, page_size: 1, total_items: all.length, line_items: [all[0]] });
  });

  it("answers 404 for an estimate or option that doesn't exist, in the documented words", async () => {
    const harness = setup();
    const missing = await harness.hcpGet("/estimates/est_missing");
    expect(missing.status).toBe(404);
    expect(await missing.json()).toEqual({ error: { message: "Estimate not found" } });
    const [estimate] = await allEstimates(harness);
    expect((await harness.hcpGet(`/estimates/${estimate!.id}/options/opt_missing/line_items`)).status).toBe(404);
  });
});
