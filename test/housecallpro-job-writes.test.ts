import { describe, expect, it } from "vitest";
import { jobCast, SCHEDULE } from "./hcp-helpers.ts";
import { setup } from "./helpers.ts";

describe("Housecall Pro twin: creating jobs", () => {
  it("creates a job for a customer at one of their addresses, numbered after the last job, answering 201", async () => {
    const harness = setup();
    const { customerId, addressId } = await jobCast(harness);
    const response = await harness.hcpPost("/jobs", { customer_id: customerId, address_id: addressId });
    expect(response.status).toBe(201);
    const job = await response.json();
    expect(job.id).toMatch(/^job_[0-9a-f]{32}$/);
    expect(job).toMatchObject({
      invoice_number: String(harness.twin.world.history.jobs.length + 1),
      customer: { id: customerId },
      address: { id: addressId },
      work_status: "needs scheduling",
      schedule: { scheduled_start: null, scheduled_end: null },
      total_amount: 0,
      created_at: "2026-07-13T11:00:00Z",
    });
    expect(await (await harness.hcpGet(`/jobs/${job.id}`)).json()).toEqual(job);
    expect(harness.twin.log.all().at(-1)).toMatchObject({ vendor: "housecallpro", type: "JobCreated", source: "api" });
  });

  it("schedules the job and dispatches its employees when the request says when and who", async () => {
    const harness = setup();
    const { customerId, addressId, employees } = await jobCast(harness);
    const job = await (
      await harness.hcpPost("/jobs", {
        customer_id: customerId,
        address_id: addressId,
        schedule: SCHEDULE,
        assigned_employee_ids: [employees[0]!.id],
      })
    ).json();
    expect(job).toMatchObject({
      work_status: "scheduled",
      schedule: { scheduled_start: "2026-07-20T14:00:00Z", scheduled_end: "2026-07-20T16:00:00Z", arrival_window: 60 },
      assigned_employees: [{ id: employees[0]!.id }],
    });
    const { appointments } = await (await harness.hcpGet(`/jobs/${job.id}/appointments`)).json();
    expect(appointments).toEqual([expect.objectContaining({ arrival_window_minutes: 60, dispatched_employees_ids: [employees[0]!.id] })]);
  });

  it("writes the local schedule with the offset the company's time zone has that day, standard time in winter", async () => {
    const harness = setup();
    const { customerId, addressId } = await jobCast(harness);
    const company = await (await harness.hcpGet("/company")).json();
    expect(company.time_zone).toBe("America/Chicago"); // seed 42's business is in Texas

    const local = async (scheduled_start: string, scheduled_end: string) => {
      const job = await (
        await harness.hcpPost("/jobs", { customer_id: customerId, address_id: addressId, schedule: { scheduled_start, scheduled_end } })
      ).json();
      const { appointments } = await (await harness.hcpGet(`/jobs/${job.id}/appointments`)).json();
      return { start: job.schedule.scheduled_start_local, end: job.schedule.scheduled_end_local, date: appointments[0].start_date };
    };
    // 5:30 UTC on December 15 is still the evening of the 14th in Chicago, six hours behind in winter.
    expect(await local("2026-12-15T05:30:00Z", "2026-12-15T06:30:00Z")).toEqual({
      start: "2026-12-14T23:30:00-06:00",
      end: "2026-12-15T00:30:00-06:00",
      date: "2026-12-14",
    });
    expect(await local("2026-07-20T14:00:00Z", "2026-07-20T15:00:00Z")).toEqual({
      start: "2026-07-20T09:00:00-05:00",
      end: "2026-07-20T10:00:00-05:00",
      date: "2026-07-20",
    });
  });

  it("keeps the employees assigned to a job without a schedule", async () => {
    const harness = setup();
    const { customerId, addressId, employees } = await jobCast(harness);
    const job = await (
      await harness.hcpPost("/jobs", { customer_id: customerId, address_id: addressId, assigned_employee_ids: [employees[1]!.id] })
    ).json();
    expect(job.work_status).toBe("needs scheduling");
    expect(job.assigned_employees.map((employee: { id: string }) => employee.id)).toEqual([employees[1]!.id]);
  });

  it("prices the job's line items in cents, as labor and taxable unless told otherwise", async () => {
    const harness = setup();
    const { customerId, addressId } = await jobCast(harness);
    const line_items = [
      { name: "Service call", unit_price: 8900 },
      { name: "Filter", unit_price: 1850, quantity: 2.5, kind: "materials", taxable: false, description: "MERV 8" },
    ];
    const job = await (
      await harness.hcpPost("/jobs", { customer_id: customerId, address_id: addressId, line_items, tags: ["warranty"] })
    ).json();
    expect(job).toMatchObject({ total_amount: 8900 + 4625, subtotal: 13525, outstanding_balance: 13525, tags: ["warranty"] });
    const { data } = await (await harness.hcpGet(`/jobs/${job.id}/line_items`)).json();
    expect(data).toEqual([
      expect.objectContaining({ name: "Service call", quantity: 1, unit_cost: 0, kind: "labor", taxable: true, amount: 8900 }),
      expect.objectContaining({ name: "Filter", quantity: 2.5, kind: "materials", taxable: false, amount: 4625, description: "MERV 8" }),
    ]);
  });

  it("rounds a line's half cent up, as the QuickBooks and Jobber twins do, so the same line comes to the same amount", async () => {
    const harness = setup();
    const { customerId, addressId } = await jobCast(harness);
    // 2.01 × $34.50 is $69.345 exactly; as floating point it is a hair under, which plain rounding takes down to $69.34.
    const lines = [
      { name: "Wire (per ft)", unit_price: 3450, quantity: 2.01 },
      { name: "Filters", unit_price: 750, quantity: 0.29 },
      { name: "Labor", unit_price: 2450, quantity: 0.57 },
    ];
    const job = await (await harness.hcpPost("/jobs", { customer_id: customerId, address_id: addressId, line_items: lines })).json();
    const { data } = await (await harness.hcpGet(`/jobs/${job.id}/line_items`)).json();
    expect(data.map((line: { amount: number }) => line.amount)).toEqual([6935, 218, 1397]);
    expect(job.total_amount).toBe(6935 + 218 + 1397);
  });

  it("takes the invoice number a request gives, and refuses one another job has, as it must be unique", async () => {
    const harness = setup();
    const { customerId, addressId } = await jobCast(harness);
    const job = await (await harness.hcpPost("/jobs", { customer_id: customerId, address_id: addressId, invoice_number: 5000 })).json();
    expect(job.invoice_number).toBe("5000");
    const next = await (await harness.hcpPost("/jobs", { customer_id: customerId, address_id: addressId })).json();
    expect(next.invoice_number).toBe("5001");

    const taken = await harness.hcpPost("/jobs", { customer_id: customerId, address_id: addressId, invoice_number: 1 });
    expect(taken.status).toBe(422);
    expect((await taken.json()).error.message).toMatch(/invoice_number 1 is taken/i);
  });

  it("reads null on an optional field as not sent, as clients generated from the OpenAPI spec send it", async () => {
    const harness = setup();
    const { customerId, addressId } = await jobCast(harness);
    const response = await harness.hcpPost("/jobs", {
      customer_id: customerId,
      address_id: addressId,
      invoice_number: null,
      tags: null,
      notes: null,
      lead_source: null,
      job_fields: { job_type_id: null, business_unit_id: null },
      schedule: { scheduled_start: "2026-07-20T14:00:00Z", scheduled_end: "2026-07-20T15:00:00Z", arrival_window: null, anytime: null },
      line_items: [{ name: "Defaults", unit_price: null, unit_cost: null, quantity: null, kind: null, taxable: null, pricing_form: null }],
    });
    expect(response.status).toBe(201);
    const job = await response.json();
    expect(job).toMatchObject({ tags: [], notes: [], schedule: { arrival_window: 0 }, total_amount: 0 });
    const { data } = await (await harness.hcpGet(`/jobs/${job.id}/line_items`)).json();
    expect(data[0]).toMatchObject({ quantity: 1, unit_price: 0, unit_cost: 0, kind: "labor", taxable: true });
    expect((await harness.hcpPost("/jobs", { customer_id: customerId, address_id: addressId, line_items: null })).status).toBe(201);
  });

  it("takes an invoice number sent as digits in a string, as every answer writes it, and refuses one that isn't a number", async () => {
    const harness = setup();
    const { customerId, addressId } = await jobCast(harness);
    const job = await (await harness.hcpPost("/jobs", { customer_id: customerId, address_id: addressId, invoice_number: "6001" })).json();
    expect(job.invoice_number).toBe("6001");
    const lettered = await harness.hcpPost("/jobs", { customer_id: customerId, address_id: addressId, invoice_number: "INV-6002" });
    expect(lettered.status).toBe(422);
    expect((await lettered.json()).error.message).toMatch(/invoice_number/);
  });

  it("takes a large quantity with two decimal places, and refuses a third", async () => {
    const harness = setup();
    const { customerId, addressId } = await jobCast(harness);
    const post = (quantity: number) =>
      harness.hcpPost("/jobs", {
        customer_id: customerId,
        address_id: addressId,
        line_items: [{ name: "Wire (per inch)", quantity, unit_price: 1 }],
      });
    for (const quantity of [1234567.89, 9876543.21, 0.29]) expect((await post(quantity)).status, String(quantity)).toBe(201);
    expect((await post(1234567.891)).status).toBe(422);
  });

  it("keeps the job's notes as one note with an id, and its lead source; blank notes are no note", async () => {
    const harness = setup();
    const { customerId, addressId } = await jobCast(harness);
    const job = await (
      await harness.hcpPost("/jobs", { customer_id: customerId, address_id: addressId, notes: "Gate code 4411", lead_source: "Google" })
    ).json();
    expect(job.notes).toEqual([{ id: expect.stringMatching(/^note_[0-9a-f]{32}$/), content: "Gate code 4411" }]);
    expect(job.lead_source).toBe("Google");
    expect(await (await harness.hcpGet(`/jobs/${job.id}`)).json()).toEqual(job);

    const blank = await (await harness.hcpPost("/jobs", { customer_id: customerId, address_id: addressId, notes: "   " })).json();
    expect(blank).toMatchObject({ notes: [], lead_source: null });
  });

  it("reads a schedule sent with a UTC offset, and answers it in UTC", async () => {
    const harness = setup();
    const { customerId, addressId } = await jobCast(harness);
    const schedule = { scheduled_start: "2026-07-20T09:00:00-05:00", scheduled_end: "2026-07-20T11:00:00-05:00" };
    const job = await (await harness.hcpPost("/jobs", { customer_id: customerId, address_id: addressId, schedule })).json();
    expect(job.schedule).toMatchObject({ scheduled_start: "2026-07-20T14:00:00Z", scheduled_end: "2026-07-20T16:00:00Z" });
  });

  it("assigns an employee once, however many times the request names them", async () => {
    const harness = setup();
    const { customerId, addressId, employees } = await jobCast(harness);
    const id = employees[0]!.id;
    const job = await (
      await harness.hcpPost("/jobs", { customer_id: customerId, address_id: addressId, assigned_employee_ids: [id, id, id] })
    ).json();
    expect(job.assigned_employees.map((employee: { id: string }) => employee.id)).toEqual([id]);
  });
});
