import { describe, expect, it } from "vitest";
import type { WorldJob } from "../src/world/history.ts";
import { setup } from "./helpers.ts";

type Harness = ReturnType<typeof setup>;

/** The parts of a job these tests read. */
interface Job {
  id: string;
  invoice_number: string;
  created_at: string;
  work_status: string;
  customer: { id: string };
  assigned_employees: { id: string; first_name: string }[];
  schedule: {
    scheduled_start: string;
    scheduled_end: string;
    scheduled_start_local: string;
    time_zone: string;
    appointments?: { dispatched_employees_ids: string[] }[];
  };
  work_timestamps: { completed_at: string | null };
  total_amount: number;
  original_estimate_id: string | null;
  original_estimate_uuids: string[] | null;
}

const cents = (job: WorldJob) => job.lineItems.reduce((total, line) => total + Math.round(line.quantity * line.unitPrice * 100), 0);

/** The twin's job for a world job: the job number is its invoice_number. */
async function jobFor(harness: Harness, worldJob: WorldJob, query = ""): Promise<Job> {
  const all = (await (await harness.hcpGet(`/jobs?page_size=1000${query}`)).json()).jobs as Job[];
  return all.find((job) => job.invoice_number === String(worldJob.number))!;
}

const finishedJob = (harness: Harness) => harness.twin.world.history.jobs.find((job) => job.visits.every((visit) => visit.completedAt))!;
const futureJob = (harness: Harness) => harness.twin.world.history.jobs.find((job) => job.visits.every((visit) => !visit.completedAt))!;

describe("Housecall Pro twin: listing jobs", () => {
  it("lists the business's jobs, newest first, with the page counts", async () => {
    const { twin, hcpGet } = setup();
    const body = await (await hcpGet("/jobs")).json();
    const total = twin.world.history.jobs.length;
    expect(body).toMatchObject({ page: 1, page_size: 10, total_items: total, total_pages: Math.ceil(total / 10) });
    const created = body.jobs.map((job: Job) => job.created_at);
    expect(created).toEqual([...created].sort().reverse());
    expect(body.jobs[0].id).toMatch(/^job_[0-9a-f]{32}$/);
  });

  it("filters jobs by customer, employee, scheduled times, and work status", async () => {
    const harness = setup();
    const { hcpGet } = harness;
    const sample = await jobFor(harness, finishedJob(harness));
    const list = async (query: string) => (await (await hcpGet(`/jobs?page_size=1000&${query}`)).json()).jobs as Job[];

    const forCustomer = await list(`customer_id=${sample.customer.id}`);
    expect(forCustomer.length).toBeGreaterThan(0);
    expect(forCustomer.every((job) => job.customer.id === sample.customer.id)).toBe(true);

    const employeeId = sample.assigned_employees[0]!.id;
    const forEmployee = await list(`employee_ids[]=${employeeId}`);
    expect(forEmployee.every((job) => job.assigned_employees.some((employee) => employee.id === employeeId))).toBe(true);

    const since = "2026-07-13T00:00:00Z";
    const upcoming = await list(`scheduled_start_min=${since}`);
    expect(upcoming.length).toBeGreaterThan(0);
    expect(upcoming.every((job) => job.schedule.scheduled_start >= since)).toBe(true);
    const ended = await list(`scheduled_end_max=${since}`);
    expect(ended.every((job) => job.schedule.scheduled_end <= since)).toBe(true);
    expect(ended.length + upcoming.length).toBeLessThanOrEqual(harness.twin.world.history.jobs.length);

    const done = await list("work_status[]=completed");
    expect(done.length).toBeGreaterThan(0);
    expect(done.every((job) => job.work_status === "complete unrated")).toBe(true);
    const both = await list("work_status[]=completed&work_status[]=scheduled");
    expect(both.length).toBe(harness.twin.world.history.jobs.length);
  });

  it("refuses a work_status it doesn't know and a date it can't read, saying what it takes", async () => {
    const { hcpGet } = setup();
    const status = await hcpGet("/jobs?work_status[]=finished");
    expect(status.status).toBe(400);
    expect((await status.json()).error.message).toMatch(/unscheduled, scheduled, in_progress, completed, canceled/);
    const date = await hcpGet("/jobs?scheduled_start_min=next-tuesday");
    expect(date.status).toBe(400);
    expect((await date.json()).error.message).toMatch(/scheduled_start_min/);
  });
});

describe("Housecall Pro twin: one job", () => {
  it("shows a job's customer, address, technicians, and money in cents", async () => {
    const harness = setup();
    const worldJob = finishedJob(harness);
    const listed = await jobFor(harness, worldJob);
    const job = await (await harness.hcpGet(`/jobs/${listed.id}`)).json();
    const person = harness.twin.world.customers.find((customer) => customer.key === worldJob.customerKey)!;
    const techs = harness.twin.world.technicians.filter((tech) => worldJob.visits[0]!.technicianKeys.includes(tech.key));

    expect(job).toMatchObject({
      description: worldJob.title,
      customer: { email: person.email, first_name: person.firstName },
      address: { street: person.street, type: "service" },
      total_amount: cents(worldJob),
      subtotal: cents(worldJob),
      company_name: harness.twin.world.company.name,
    });
    expect(job.assigned_employees.map((employee: { first_name: string }) => employee.first_name).sort()).toEqual(
      techs.map((tech) => tech.firstName).sort(),
    );
  });

  it("says a job is complete once its work is done, with when it started and finished", async () => {
    const harness = setup();
    const worldJob = finishedJob(harness);
    const job = await jobFor(harness, worldJob);
    expect(job.work_status).toBe("complete unrated");
    expect(job.work_timestamps).toEqual({
      on_my_way_at: null,
      started_at: worldJob.visits[0]!.startAt.replace(".000Z", "Z"),
      completed_at: worldJob.visits.at(-1)!.completedAt!.replace(".000Z", "Z"),
    });
  });

  it("keeps a job scheduled after its time has passed, until someone marks the work done", async () => {
    const harness = setup();
    const worldJob = futureJob(harness);
    expect((await jobFor(harness, worldJob)).work_status).toBe("scheduled");
    harness.twin.advance(30 * 86_400_000);
    const later = await jobFor(harness, worldJob);
    expect(later.work_status).toBe("scheduled");
    expect(later.work_timestamps.completed_at).toBeNull();
  });

  it("shows a two-visit job as one job with two appointments, its schedule spanning both", async () => {
    const harness = setup();
    const worldJob = harness.twin.world.history.jobs.find((job) => job.visits.length === 2)!;
    const job = await jobFor(harness, worldJob, "&expand[]=appointments");
    expect(job.schedule.scheduled_start).toBe(worldJob.visits[0]!.startAt.replace(".000Z", "Z"));
    expect(job.schedule.scheduled_end).toBe(worldJob.visits[1]!.endAt.replace(".000Z", "Z"));
    const appointments = job.schedule.appointments!;
    expect(appointments).toHaveLength(2);
    expect(appointments[0]).toMatchObject({ anytime: false, arrival_window_minutes: 0 });
    expect(appointments[0]!.dispatched_employees_ids).toHaveLength(worldJob.visits[0]!.technicianKeys.length);

    const listed = await (await harness.hcpGet(`/jobs/${job.id}/appointments`)).json();
    expect(listed.appointments).toEqual(job.schedule.appointments);
    expect((await jobFor(harness, worldJob)).schedule.appointments).toBeUndefined();
  });

  it("gives the schedule in the business's own time zone too, with its offset", async () => {
    const harness = setup();
    const job = await jobFor(harness, futureJob(harness));
    const { utcOffsetHours, state } = harness.twin.world.company;
    expect(job.schedule.time_zone).toBe(state === "TX" ? "America/Chicago" : "America/New_York");
    const local = new Date(Date.parse(job.schedule.scheduled_start) + utcOffsetHours * 3_600_000).toISOString().slice(0, 19);
    expect(job.schedule.scheduled_start_local).toBe(`${local}-0${-utcOffsetHours}:00`);
  });

  it("points a job that came from a quote at its estimate", async () => {
    const harness = setup();
    const quoted = harness.twin.world.history.jobs.find((job) => job.quoteKey)!;
    const job = await jobFor(harness, quoted);
    expect(job.original_estimate_id).toMatch(/^est_[0-9a-f]{32}$/);
    expect(job.original_estimate_uuids).toEqual([job.original_estimate_id]);
    const unquoted = await jobFor(harness, harness.twin.world.history.jobs.find((candidate) => !candidate.quoteKey)!);
    expect(unquoted.original_estimate_id).toBeNull();
  });

  it("lists a job's line items, priced in cents, labor and materials", async () => {
    const harness = setup();
    const worldJob = harness.twin.world.history.jobs.find((job) => job.lineItems.length > 1)!;
    const job = await jobFor(harness, worldJob);
    const body = await (await harness.hcpGet(`/jobs/${job.id}/line_items`)).json();
    expect(body.url).toBe(`/jobs/${job.id}/line_items`);
    expect(body.data).toHaveLength(worldJob.lineItems.length);
    expect(body.data[0]).toMatchObject({
      name: worldJob.lineItems[0]!.name,
      unit_price: Math.round(worldJob.lineItems[0]!.unitPrice * 100),
      quantity: worldJob.lineItems[0]!.quantity,
      kind: "labor",
      order_index: 0,
    });
    expect(body.data[1]).toMatchObject({ kind: "materials", taxable: true });
    expect(body.data.reduce((total: number, line: { amount: number }) => total + line.amount, 0)).toBe(job.total_amount);
  });

  it("answers 404 for a job that doesn't exist, in the documented words", async () => {
    const { hcpGet } = setup();
    const response = await hcpGet("/jobs/job_missing");
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: { message: "job not found" } });
    expect((await hcpGet("/jobs/job_missing/line_items")).status).toBe(404);
    expect((await hcpGet("/jobs/job_missing/appointments")).status).toBe(404);
  });
});
