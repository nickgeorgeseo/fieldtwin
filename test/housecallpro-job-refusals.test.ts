import { describe, expect, it } from "vitest";
import { jobCast, SCHEDULE } from "./hcp-helpers.ts";
import { setup } from "./helpers.ts";

/** What Create a Job refuses, and how: 422 for the request, 404 for a record it names, 501 for what the twin doesn't model. */
describe("Housecall Pro twin: job requests the twin refuses", () => {
  it("refuses a job without customer_id or address_id (422), naming what's missing", async () => {
    const harness = setup();
    const { customerId } = await jobCast(harness);
    const response = await harness.hcpPost("/jobs", { customer_id: customerId });
    expect(response.status).toBe(422);
    expect((await response.json()).error.message).toMatch(/address_id/);
  });

  it("answers 404 for a customer, an address, or an employee that doesn't exist, and changes nothing", async () => {
    const harness = setup();
    const { customerId, addressId } = await jobCast(harness);
    const before = harness.twin.log.length;
    const other = (await (await harness.hcpGet("/customers?page=2&page_size=1")).json()).customers[0];
    for (const [body, what] of [
      [{ customer_id: "cus_missing", address_id: addressId }, "customer"],
      [{ customer_id: customerId, address_id: other.addresses[0].id }, "address"],
      [{ customer_id: customerId, address_id: addressId, assigned_employee_ids: ["pro_missing"] }, "employee"],
    ] as const) {
      const response = await harness.hcpPost("/jobs", body);
      expect(response.status, what).toBe(404);
      expect((await response.json()).error.message).toBe(`${what} not found`);
    }
    expect(harness.twin.log.length).toBe(before);
  });

  it("refuses a schedule that ends before it starts, or a time it can't read", async () => {
    const harness = setup();
    const { customerId, addressId } = await jobCast(harness);
    for (const schedule of [
      { scheduled_start: SCHEDULE.scheduled_end, scheduled_end: SCHEDULE.scheduled_start },
      { scheduled_start: "tomorrow", scheduled_end: SCHEDULE.scheduled_end },
      { scheduled_start: SCHEDULE.scheduled_start },
    ]) {
      const response = await harness.hcpPost("/jobs", { customer_id: customerId, address_id: addressId, schedule });
      expect(response.status, JSON.stringify(schedule)).toBe(422);
      expect((await response.json()).error.message).toMatch(/scheduled_(start|end)/);
    }
  });

  it("refuses line items without a name, or priced in fractions of a cent", async () => {
    const harness = setup();
    const { customerId, addressId } = await jobCast(harness);
    for (const [line, field] of [
      [{ unit_price: 100 }, "line_items[0].name"],
      [{ name: "Half cent", unit_price: 100.5 }, "line_items[0].unit_price"],
      [{ name: "Too precise", quantity: 1.125 }, "line_items[0].quantity"],
      [{ name: "Tip", kind: "gratuity" }, "line_items[0].kind"],
    ] as const) {
      const response = await harness.hcpPost("/jobs", { customer_id: customerId, address_id: addressId, line_items: [line] });
      expect(response.status, field).toBe(422);
      expect((await response.json()).error.message).toContain(field);
    }
  });

  it("refuses a line too large to count in whole cents, rather than answer a total of null", async () => {
    const harness = setup();
    const { customerId, addressId } = await jobCast(harness);
    const before = harness.twin.log.length;
    for (const [lines, field] of [
      [[{ name: "Huge", quantity: 1e308, unit_price: 100 }], "line_items[0]"],
      [[{ name: "Huge price", unit_price: 1e20 }], "line_items[0].unit_price"],
      [[{ name: "Huge cost", unit_cost: 2 ** 60 }], "line_items[0].unit_cost"],
      // Each line is safe on its own (2^46 cents), and together they come to 2^53, the first sum that isn't.
      [Array.from({ length: 128 }, () => ({ name: "A 128th of too much", unit_price: 2 ** 46 })), "line_items come to more"],
    ] as const) {
      const response = await harness.hcpPost("/jobs", { customer_id: customerId, address_id: addressId, line_items: lines });
      expect(response.status, field).toBe(422);
      expect((await response.json()).error.message).toContain(field);
    }
    expect(harness.twin.log.length).toBe(before);
  });

  it("refuses an invoice number too large to be a whole number, so the next one can still follow it", async () => {
    const harness = setup();
    const { customerId, addressId } = await jobCast(harness);
    const response = await harness.hcpPost("/jobs", { customer_id: customerId, address_id: addressId, invoice_number: 1e21 });
    expect(response.status).toBe(422);
    expect((await response.json()).error.message).toMatch(/invoice_number/);
    const next = await (await harness.hcpPost("/jobs", { customer_id: customerId, address_id: addressId })).json();
    expect(next.invoice_number).toBe(String(harness.twin.world.history.jobs.length + 1));
  });

  it("refuses a schedule that ends within the second it starts, since times are kept to the second", async () => {
    const harness = setup();
    const { customerId, addressId } = await jobCast(harness);
    const schedule = { scheduled_start: "2026-07-20T14:00:00.100Z", scheduled_end: "2026-07-20T14:00:00.900Z" };
    const response = await harness.hcpPost("/jobs", { customer_id: customerId, address_id: addressId, schedule });
    expect(response.status).toBe(422);
    expect((await response.json()).error.message).toMatch(/scheduled_end must be after/);
  });

  it("refuses an arrival window too large to count in whole minutes, as it refuses such amounts", async () => {
    const harness = setup();
    const { customerId, addressId } = await jobCast(harness);
    const schedule = { ...SCHEDULE, arrival_window: 1e21 };
    const response = await harness.hcpPost("/jobs", { customer_id: customerId, address_id: addressId, schedule });
    expect(response.status).toBe(422);
    expect((await response.json()).error.message).toMatch(/arrival_window/);
  });

  it("refuses a schedule before 1900, when the company's zone had no offset in whole minutes to write its local times with", async () => {
    const harness = setup();
    const { customerId, addressId } = await jobCast(harness);
    for (const day of ["0999-06-01", "1883-01-01"]) {
      const schedule = { scheduled_start: `${day}T15:00:00Z`, scheduled_end: `${day}T16:00:00Z` };
      const response = await harness.hcpPost("/jobs", { customer_id: customerId, address_id: addressId, schedule });
      expect(response.status, day).toBe(422);
      expect((await response.json()).error.message).toMatch(/scheduled_start.*1900/);
    }
  });

  it("refuses to number a job after the largest invoice number it can count to, rather than repeat it", async () => {
    const harness = setup();
    const { customerId, addressId } = await jobCast(harness);
    const top = await harness.hcpPost("/jobs", { customer_id: customerId, address_id: addressId, invoice_number: Number.MAX_SAFE_INTEGER });
    expect(top.status).toBe(201);
    const next = await harness.hcpPost("/jobs", { customer_id: customerId, address_id: addressId });
    expect(next.status).toBe(422);
    expect((await next.json()).error.message).toMatch(/invoice_number/);
  });

  it("says it doesn't model anytime schedules, price forms, discount lines, or job types yet (501)", async () => {
    const harness = setup();
    const { customerId, addressId } = await jobCast(harness);
    for (const extra of [
      { schedule: { anytime: true, anytime_start_date: "2026-07-20" } },
      { line_items: [{ name: "Formed", pricing_form: { id: "pbpf_1" } }] },
      { line_items: [{ name: "Loyalty", kind: "fixed discount" }] },
      { job_fields: { job_type_id: "jt_1" } },
    ]) {
      const response = await harness.hcpPost("/jobs", { customer_id: customerId, address_id: addressId, ...extra });
      expect(response.status, JSON.stringify(extra)).toBe(501);
      expect((await response.json()).error.message).toMatch(/doesn't model/);
    }
  });

  it("says a customer doesn't exist before saying job types aren't modeled, so the client fixes the request first", async () => {
    const harness = setup();
    const { addressId } = await jobCast(harness);
    const response = await harness.hcpPost("/jobs", {
      customer_id: "cus_missing",
      address_id: addressId,
      job_fields: { job_type_id: "jt_1" },
    });
    expect(response.status).toBe(404);
    expect((await response.json()).error.message).toBe("customer not found");
  });

  it("refuses an optional field of the wrong type (422), naming it", async () => {
    const harness = setup();
    const { customerId, addressId } = await jobCast(harness);
    const before = harness.twin.log.length;
    for (const [extra, field] of [
      [{ assigned_employee_ids: "pro_1" }, "assigned_employee_ids"],
      [{ tags: "warranty" }, "tags"],
      [{ schedule: "tomorrow" }, "schedule"],
      [{ lead_source: 42 }, "lead_source"],
      [{ notes: ["Gate code 4411"] }, "notes"],
    ] as const) {
      const response = await harness.hcpPost("/jobs", { customer_id: customerId, address_id: addressId, ...extra });
      expect(response.status, field).toBe(422);
      expect((await response.json()).error.message).toContain(field);
    }
    expect(harness.twin.log.length).toBe(before);
  });

  it("refuses an invoice number of 0 or below, since numbers count from 1", async () => {
    const harness = setup();
    const { customerId, addressId } = await jobCast(harness);
    for (const invoice_number of [0, -5]) {
      const response = await harness.hcpPost("/jobs", { customer_id: customerId, address_id: addressId, invoice_number });
      expect(response.status, String(invoice_number)).toBe(422);
      expect((await response.json()).error.message).toMatch(/invoice_number must be a whole number from 1/);
    }
  });
});
