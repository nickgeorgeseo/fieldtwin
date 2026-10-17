import { describe, expect, it } from "vitest";
import { advanceClock, loadScenario, loadScenarioByName, runAction } from "../src/control/operations.ts";
import type { HcpState } from "../src/vendors/housecallpro/types/index.ts";
import { setup } from "./helpers.ts";

/** What a scenario timeline can make happen in Housecall Pro, as if a Pro did it in the app. */

const scenario = (timeline: string) => `
name: A day in Housecall Pro
seed: 42
startTime: "2026-07-13T11:00:00Z"
timeline:
${timeline}
`;

type Harness = ReturnType<typeof setup>;
const state = (harness: Harness) => harness.twin.state<HcpState>("housecallpro");
const customers = (harness: Harness) => [...state(harness).customers.values()];
const nameOf = (customer: { first_name: string | null; last_name: string | null }) => `${customer.first_name} ${customer.last_name}`;

describe("Housecall Pro newCustomers", () => {
  it("brings in new customers, each with a name nobody in the business has, an email, a phone, and a service address", async () => {
    const harness = setup();
    const before = new Set(customers(harness).map((customer) => customer.id));
    await runAction(harness.twin, "housecallpro", "newCustomers", 3);

    const newcomers = customers(harness).filter((customer) => !before.has(customer.id));
    expect(newcomers).toHaveLength(3);
    const worldNames = new Set(harness.twin.world.customers.map((person) => `${person.firstName} ${person.lastName}`));
    for (const customer of newcomers) {
      expect(worldNames.has(nameOf(customer))).toBe(false);
      expect(customer.email).toMatch(/^[a-z0-9.]+@example\.com$/);
      expect(customer.mobile_number).toMatch(/^555-\d{3}-\d{4}$/);
      expect(customer.addresses).toEqual([expect.objectContaining({ type: "service", city: harness.twin.world.company.city })]);
      expect(customer.created_at).toBe("2026-07-13T11:00:00Z");
    }
    expect(new Set(newcomers.map(nameOf)).size).toBe(3);

    // They are customers like any other: the API serves them, and one created through it next gets an id of its own.
    const listed = await (await harness.hcpGet("/customers?page_size=100&sort_direction=asc")).json();
    expect(listed.customers.slice(-3).map((customer: { id: string }) => customer.id)).toEqual(newcomers.map((customer) => customer.id));
    const total = customers(harness).length;
    await harness.hcpPost("/customers", { first_name: "Wren" });
    expect(customers(harness)).toHaveLength(total + 1);
  });

  it("brings them in at their time in a scenario, recorded with source scenario", async () => {
    const harness = setup();
    loadScenario(harness.twin, scenario(`  - at: "+1h"\n    housecallpro: { newCustomers: 2 }`));
    const count = customers(harness).length;
    await advanceClock(harness.twin, 59);
    expect(customers(harness)).toHaveLength(count);
    await advanceClock(harness.twin, 1);
    expect(customers(harness)).toHaveLength(count + 2);
    const recorded = harness.twin.log.all().slice(-2);
    expect(recorded.map((event) => [event.type, event.source, event.at])).toEqual([
      ["CustomerCreated", "scenario", "2026-07-13T12:00:00.000Z"],
      ["CustomerCreated", "scenario", "2026-07-13T12:00:00.000Z"],
    ]);
  });

  it("doesn't take the name of a customer who is only in the books", async () => {
    const harness = setup();
    loadScenarioByName(harness.twin, "mismatched-books");
    const before = new Set(customers(harness).map((customer) => customer.id));
    await runAction(harness.twin, "housecallpro", "newCustomers", 300);
    const worldNames = new Set(harness.twin.world.customers.map((person) => `${person.firstName} ${person.lastName}`));
    const newcomers = customers(harness).filter((customer) => !before.has(customer.id));
    expect(newcomers).toHaveLength(300);
    for (const customer of newcomers) expect(worldNames.has(nameOf(customer))).toBe(false);
    expect(new Set(customers(harness).map(nameOf)).size).toBe(customers(harness).length);
  });

  it("refuses, when the scenario loads, a count that isn't a whole number of 1 or more", () => {
    const harness = setup();
    expect(() => loadScenario(harness.twin, scenario(`  - at: "+1h"\n    housecallpro: { newCustomers: "lots" }`))).toThrow(
      /housecallpro newCustomers takes how many/,
    );
    expect(() => loadScenario(harness.twin, scenario(`  - at: "+1h"\n    housecallpro: { newCustomers: 0 }`))).toThrow(/newCustomers/);
  });
});

/**
 * Seed 42's scheduled jobs on Monday 2026-07-13 (UTC): #36 at 13:00, #38 at 16:30 with a second visit on Tuesday at
 * 16:30, and #42 at 19:30. The twin starts at 11:00, before any of them.
 */
const jobNumbered = (harness: Harness, number: string) => [...state(harness).jobs.values()].find((job) => job.invoice_number === number)!;
const jobAnswer = async (harness: Harness, number: string) => (await harness.hcpGet(`/jobs/${jobNumbered(harness, number).id}`)).json();

describe("Housecall Pro completeJobs", () => {
  it("finishes the job whose visit began first, so its work is complete unrated as of now", async () => {
    const harness = setup();
    await advanceClock(harness.twin, 9 * 60); // 20:00: #36 and #42 have begun
    const { events } = await runAction(harness.twin, "housecallpro", "completeJobs", 1);

    expect(events).toEqual([expect.stringMatching(/housecallpro {2}JobUpdated #36 .*\(complete\) {2}\(control\)$/)]);
    expect(await jobAnswer(harness, "36")).toMatchObject({
      work_status: "complete unrated",
      work_timestamps: { started_at: "2026-07-13T13:00:00Z", completed_at: "2026-07-13T20:00:00Z" },
      updated_at: "2026-07-13T20:00:00Z",
    });
    expect((await jobAnswer(harness, "42")).work_status).toBe("scheduled");
  });

  it("leaves work that hasn't begun, and a job whose next visit is still ahead, until its time comes", async () => {
    const harness = setup();
    expect((await runAction(harness.twin, "housecallpro", "completeJobs", 5)).events).toEqual([]); // 11:00: nothing has begun

    await advanceClock(harness.twin, 9 * 60);
    const { events } = await runAction(harness.twin, "housecallpro", "completeJobs", 5);
    expect(events.map((event) => /JobUpdated (#\d+)/.exec(event)?.[1])).toEqual(["#36", "#42"]);
    expect((await jobAnswer(harness, "38")).work_status).toBe("scheduled");
    expect((await jobAnswer(harness, "44")).work_status).toBe("scheduled");

    await advanceClock(harness.twin, 21 * 60); // Tuesday 17:00: #38's second visit has begun
    await runAction(harness.twin, "housecallpro", "completeJobs", 5);
    const job = await (await harness.hcpGet(`/jobs/${jobNumbered(harness, "38").id}/appointments`)).json();
    expect(job.appointments).toHaveLength(2);
    expect(await jobAnswer(harness, "38")).toMatchObject({
      work_status: "complete unrated",
      work_timestamps: { started_at: "2026-07-13T16:30:00Z", completed_at: "2026-07-14T17:00:00Z" },
    });
  });

  it("finishes jobs at their time in a scenario, recorded with source scenario, and checks the count when it loads", async () => {
    const harness = setup();
    loadScenario(harness.twin, scenario(`  - at: "+3h"\n    housecallpro: { completeJobs: 1 }`));
    await advanceClock(harness.twin, 3 * 60);
    expect(harness.twin.log.all().at(-1)).toMatchObject({ type: "JobUpdated", source: "scenario", at: "2026-07-13T14:00:00.000Z" });
    expect((await jobAnswer(harness, "36")).work_status).toBe("complete unrated");

    expect(() => loadScenario(harness.twin, scenario(`  - at: "+1h"\n    housecallpro: { completeJobs: 1.5 }`))).toThrow(
      /housecallpro completeJobs takes how many/,
    );
  });

  it("adds nothing to a job, so what is created next is numbered as before", async () => {
    const harness = setup();
    await advanceClock(harness.twin, 9 * 60);
    const before = { ...state(harness).counts };
    await runAction(harness.twin, "housecallpro", "completeJobs", 2);
    expect(state(harness).counts).toEqual(before);
  });
});

/** Seed 42 has eight open invoices. The two due longest ago are #23 (due July 12) and #25 (due July 21). */
const invoiceNumbered = (harness: Harness, number: string) =>
  [...state(harness).invoices.values()].find((invoice) => invoice.invoice_number === number)!;
const invoiceAnswer = async (harness: Harness, number: string) =>
  (await harness.hcpGet(`/api/invoices/${invoiceNumbered(harness, number).id}`)).json();
const openInvoices = async (harness: Harness) =>
  (await (await harness.hcpGet("/invoices?status=open&page_size=100")).json()).invoices.map(
    (invoice: { invoice_number: string }) => invoice.invoice_number,
  );

describe("Housecall Pro payInvoices", () => {
  it("pays the open invoices due longest ago in full, with one payment for what was still owed", async () => {
    const harness = setup();
    const { amount } = await invoiceAnswer(harness, "23");
    const { events } = await runAction(harness.twin, "housecallpro", "payInvoices", 2);

    expect(events.map((event) => /InvoiceUpdated (#\d+)/.exec(event)?.[1])).toEqual(["#23", "#25"]);
    const invoice = await invoiceAnswer(harness, "23");
    expect(invoice).toMatchObject({ status: "paid", due_amount: 0, paid_at: "2026-07-13T11:00:00Z" });
    expect(invoice.payments).toEqual([
      expect.objectContaining({ amount, status: "succeeded", payment_method: "external", paid_at: "2026-07-13T11:00:00Z" }),
    ]);
    const job = await (await harness.hcpGet(`/jobs/${invoice.job_id}`)).json();
    expect(job.outstanding_balance).toBe(0);
    expect(await openInvoices(harness)).toHaveLength(6);
  });

  it("pays no more invoices than are open, and never pays one twice", async () => {
    const harness = setup();
    expect((await runAction(harness.twin, "housecallpro", "payInvoices", 50)).events).toHaveLength(8);
    expect((await runAction(harness.twin, "housecallpro", "payInvoices", 1)).events).toEqual([]);
    expect(await openInvoices(harness)).toEqual([]);

    // Each payment has an id of its own, the seeded ones included.
    const payments = [...state(harness).invoices.values()].flatMap((invoice) => invoice.payments.map((payment) => payment.id));
    expect(new Set(payments).size).toBe(payments.length);
    expect(state(harness).counts.payments).toBe(payments.length);
  });

  it("pays invoices at their time in a scenario, recorded with source scenario, and checks the count when it loads", async () => {
    const harness = setup();
    loadScenario(harness.twin, scenario(`  - at: "+2h"\n    housecallpro: { payInvoices: 1 }`));
    await advanceClock(harness.twin, 2 * 60);
    expect(harness.twin.log.all().at(-1)).toMatchObject({ type: "InvoiceUpdated", source: "scenario", at: "2026-07-13T13:00:00.000Z" });
    expect((await invoiceAnswer(harness, "23")).paid_at).toBe("2026-07-13T13:00:00Z");

    expect(() => loadScenario(harness.twin, scenario(`  - at: "+1h"\n    housecallpro: { payInvoices: [1] }`))).toThrow(
      /housecallpro payInvoices takes how many/,
    );
  });
});
