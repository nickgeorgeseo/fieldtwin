import { type ConformanceCase, expectOk, housecallpro } from "../case.ts";
import { customersJobsInclude, errorOf, eventually, jobsCustomer, newJob, shapeOf } from "./housecallpro-shared.ts";

/**
 * Housecall Pro cases that make jobs, all for one customer, "fieldtwin conformance jobs ...", made once per run:
 * Housecall Pro's API can delete neither jobs nor customers, so they stay in the account. Nobody is dispatched to them,
 * and a visit is on a day in January 2020, long past, so no reminder goes out. They run last.
 * https://docs.housecallpro.com/docs/housecall-public-api/2dcf481ed7d69-create-a-job
 */

/** A visit on a weekday in January 2020, an hour long. */
const PAST_VISIT = { scheduled_start: "2020-01-15T15:00:00Z", scheduled_end: "2020-01-15T16:00:00Z" };

export const housecallproJobWriteCases: ConformanceCase[] = [
  {
    name: "line-item-defaults",
    vendor: "housecallpro",
    endpoint: "POST /jobs",
    fidelity: "Creating a job: line items",
    writes: true,
    async observe(target) {
      // A line with only its name and a price, so the job's lines show what the rest default to.
      const job = await newJob(target, { line_items: [{ name: "fieldtwin conformance line", unit_price: 100 }] });
      const line = expectOk(await housecallpro(target, "GET", `/jobs/${job.id}/line_items`), "list the job's line items").data?.[0] ?? {};
      return { quantity: line.quantity ?? null, kind: line.kind ?? null, taxable: line.taxable ?? null, unitCost: line.unit_cost ?? null };
    },
  },
  {
    name: "job-line-items",
    vendor: "housecallpro",
    endpoint: "GET /jobs/{id}/line_items",
    fidelity: "GET /jobs/{id}/line_items",
    writes: true,
    async observe(target) {
      const job = await newJob(target, {
        line_items: [
          { name: "fieldtwin conformance labor", unit_price: 150, quantity: 2, kind: "labor" },
          { name: "fieldtwin conformance part", unit_price: 100, quantity: 1.5, kind: "materials" },
        ],
      });
      const path = `/jobs/${job.id}/line_items`;
      const answer = expectOk(await housecallpro(target, "GET", path), "list the job's line items");
      const lines: { amount: number; quantity: number; unit_price: number; order_index?: number }[] = answer.data ?? [];
      return {
        keys: Object.keys(answer ?? {}).sort(),
        // The docs say what neither order_index nor url holds.
        orderIndexes: lines.map((line) => line.order_index ?? null),
        url: answer.url === path ? "the list's path" : String(answer.url ?? "").endsWith(path) ? "the list's URL" : shapeOf(answer.url),
        amountIsQuantityTimesPrice:
          lines.length === 2 && lines.every((line) => line.amount === Math.round(line.quantity * line.unit_price)),
      };
    },
  },
  {
    name: "job-without-an-address",
    vendor: "housecallpro",
    endpoint: "POST /jobs",
    fidelity: "POST /jobs",
    // JobCreate requires customer_id and address_id: a job is made only if Housecall Pro takes one without the address.
    writes: true,
    observe: async (target) => errorOf(await housecallpro(target, "POST", "/jobs", { customer_id: (await jobsCustomer(target)).id })),
  },
  {
    name: "schedule-without-an-end",
    vendor: "housecallpro",
    endpoint: "POST /jobs",
    fidelity: "Creating a job: the schedule",
    writes: true, // only if Housecall Pro takes a schedule with no end
    async observe(target) {
      const { id, addressId } = await jobsCustomer(target);
      const schedule = { scheduled_start: PAST_VISIT.scheduled_start };
      return errorOf(await housecallpro(target, "POST", "/jobs", { customer_id: id, address_id: addressId, schedule }));
    },
  },
  {
    name: "schedule-without-an-offset",
    vendor: "housecallpro",
    endpoint: "POST /jobs",
    fidelity: "Times without an offset",
    writes: true,
    async observe(target) {
      // 15:00 with no offset: UTC, as the Schedule object's times are, or the company's own clock?
      const zone = expectOk(await housecallpro(target, "GET", "/company"), "read the company").time_zone;
      const asUtc = Date.parse("2020-01-15T15:00:00Z");
      const atCompany = typeof zone === "string" ? wallClock(zone, "2020-01-15T15:00:00") : asUtc;
      if (atCompany === asUtc) {
        throw new Error("The company's clock reads as UTC does in January, so this case can't tell which a time without an offset is in.");
      }
      const job = await newJob(target, { schedule: { scheduled_start: "2020-01-15T15:00:00", scheduled_end: "2020-01-15T16:00:00" } });
      const start = Date.parse(job.schedule?.scheduled_start ?? "");
      if (Number.isNaN(start)) throw new Error("The new job came back without its scheduled_start, so this case can't tell.");
      if (!(await eventually(target, () => customersJobsInclude(target, job.id)))) {
        throw new Error("The new job never showed up among its customer's jobs, so this case can't tell how filters read times.");
      }
      // The filters too: the job's own start, written in UTC without an offset, finds it only if they read it as UTC.
      // An hour later mustn't find it, or they weren't applied at all.
      const unmarked = (ms: number) => new Date(ms).toISOString().slice(0, 19);
      const atStart = await customersJobsInclude(
        target,
        job.id,
        `&scheduled_start_min=${unmarked(start)}&scheduled_start_max=${unmarked(start)}`,
      );
      const anHourLater = await customersJobsInclude(target, job.id, `&scheduled_start_min=${unmarked(start + 3_600_000)}`);
      return {
        createdAs: start === asUtc ? "UTC" : start === atCompany ? "the company's time zone" : "other",
        filteredAs: anHourLater ? "not filtered" : atStart ? "UTC" : "not UTC",
      };
    },
  },
  {
    name: "work-status-words",
    vendor: "housecallpro",
    endpoint: "GET /jobs/{id}",
    fidelity: "work_status",
    writes: true,
    async observe(target) {
      // A job never scheduled, and one whose only visit ended years ago with nobody marking its work done.
      const status = async (job: { id: string }) =>
        expectOk(await housecallpro(target, "GET", `/jobs/${job.id}`), "read the job").work_status ?? null;
      return {
        neverScheduled: await status(await newJob(target)),
        visitLongOver: await status(await newJob(target, { schedule: PAST_VISIT })),
      };
    },
  },
  {
    name: "work-status-filter",
    vendor: "housecallpro",
    endpoint: "GET /jobs",
    fidelity: "Job filters",
    writes: true,
    async observe(target) {
      // The filter's statuses aren't the Job's: does "unscheduled" find a job that "needs scheduling"?
      const job = await newJob(target);
      if (!(await eventually(target, () => customersJobsInclude(target, job.id)))) {
        throw new Error("The new job never showed up among its customer's jobs, so this case can't tell what the filter finds.");
      }
      return {
        unscheduledFindsIt: await customersJobsInclude(target, job.id, "&work_status[]=unscheduled"),
        scheduledFindsIt: await customersJobsInclude(target, job.id, "&work_status[]=scheduled"),
        unknownStatus: errorOf(await housecallpro(target, "GET", "/jobs?page_size=1&work_status[]=fieldtwin_not_a_status")),
      };
    },
  },
  {
    name: "customer-notes-on-a-job",
    vendor: "housecallpro",
    endpoint: "GET /jobs/{id}",
    fidelity: "The customer on a job",
    writes: true,
    async observe(target) {
      // The jobs customer has notes: the Job schema has a customer's notes as a list of notes, the Customer schema as text.
      const job = expectOk(await housecallpro(target, "GET", `/jobs/${(await newJob(target)).id}`), "read the job");
      const customer = expectOk(await housecallpro(target, "GET", `/customers/${(await jobsCustomer(target)).id}`), "read the customer");
      return {
        notesOnTheJob: shapeOf(job.customer?.notes),
        notesOnTheCustomer: shapeOf(customer.notes),
        addressesOnTheJob: "addresses" in (job.customer ?? {}),
      };
    },
  },
  {
    name: "taken-invoice-number",
    vendor: "housecallpro",
    endpoint: "POST /jobs",
    fidelity: "POST /jobs",
    // "Invoice number must be unique across all of a company's jobs": the newest job's number, sent again. A job is made
    // only if Housecall Pro takes it, and with a number already used, the account's numbering can't move on past it.
    writes: true,
    async observe(target) {
      const { id, addressId } = await jobsCustomer(target);
      const taken = String(expectOk(await housecallpro(target, "GET", "/jobs?page_size=1"), "list jobs").jobs?.[0]?.invoice_number ?? "");
      if (!/^\d+$/.test(taken)) throw new Error("The account's newest job has no number in digits to send again, so this case can't tell.");
      return errorOf(
        await housecallpro(target, "POST", "/jobs", { customer_id: id, address_id: addressId, invoice_number: Number(taken) }),
      );
    },
  },
];

/** The moment clocks in `timeZone` read `local` ("2020-01-15T15:00:00"), from the zone's offset at about that time. */
function wallClock(timeZone: string, local: string): number {
  const asUtc = Date.parse(`${local}Z`);
  const parts = new Intl.DateTimeFormat("en-US", { timeZone, timeZoneName: "longOffset" }).formatToParts(asUtc);
  const offset = parts.find((part) => part.type === "timeZoneName")?.value ?? "GMT"; // "GMT-06:00", or "GMT" for none
  const [, sign = "+", hours = "0", minutes = "0"] = /^GMT([+-])(\d{2}):(\d{2})$/.exec(offset) ?? [];
  return asUtc - (sign === "-" ? -1 : 1) * (Number(hours) * 60 + Number(minutes)) * 60_000;
}
