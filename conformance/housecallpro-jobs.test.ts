import { describe, expect, it } from "vitest";
import { housecallproJobWriteCases } from "./cases/housecallpro-job-writes.ts";
import { observeAll } from "./run.ts";
import { answering as account, caseNamed } from "./test-support.ts";

/**
 * What the Housecall Pro cases that make jobs make of a real account's answers. They all write to one customer,
 * "fieldtwin conformance jobs ...", since Housecall Pro's API can delete neither customers nor jobs.
 */

const housecallproCase = (name: string) => caseNamed(`housecallpro/${name}`);

describe("cases that make jobs", () => {
  /** Answers for the job cases' writes: the customer they make, with an address, and the job. */
  const made = (url: URL) => ({
    status: 201,
    body: url.pathname === "/customers" ? { id: "cus_1", addresses: [{ id: "adr_1" }] } : { id: "job_1" },
  });

  it("make one customer for every job, since Housecall Pro's API can delete neither", async () => {
    let customers = 0;
    const counting = account((url, init) => {
      if (init?.method === "POST" && url.pathname === "/customers") customers++;
      return init?.method === "POST" ? made(url) : { body: { id: "c", time_zone: "America/Chicago", jobs: [{ id: "job_1" }], data: [] } };
    });
    await observeAll(counting, housecallproJobWriteCases);
    expect(customers).toBe(1);
  });

  it("tell a time without an offset read on the company's clock from one read as UTC, and can't tell in a zone at UTC", async () => {
    const offset = housecallproCase("schedule-without-an-offset");
    /** A company in `timeZone` that reads times without an offset as Chicago's in January, in writes and filters alike. */
    const readingChicagoTime = (timeZone: string) => {
      const chicago = (text: string) => Date.parse(`${text}-06:00`);
      const jobs: { id: string; start: number }[] = [];
      return account((url, init) => {
        if (url.pathname === "/company") return { body: { id: "c", time_zone: timeZone } };
        if (init?.method === "POST" && url.pathname === "/jobs") {
          jobs.push({ id: `job_${jobs.length + 1}`, start: chicago(JSON.parse(String(init.body)).schedule.scheduled_start) });
          return { status: 201, body: { id: jobs.at(-1)!.id, schedule: { scheduled_start: new Date(jobs.at(-1)!.start).toISOString() } } };
        }
        if (init?.method === "POST") return made(url);
        const [min, max] = [url.searchParams.get("scheduled_start_min"), url.searchParams.get("scheduled_start_max")];
        const within = (job: { start: number }) =>
          (min === null || job.start >= chicago(min)) && (max === null || job.start <= chicago(max));
        return { body: { jobs: jobs.filter(within) } };
      });
    };
    await expect(offset.observe(readingChicagoTime("America/Chicago"))).resolves.toEqual({
      createdAs: "the company's time zone",
      filteredAs: "not UTC",
    });
    await expect(offset.observe(readingChicagoTime("Europe/London"))).rejects.toThrow("can't tell");
  });

  it("record nothing about the work_status filter when the new job never shows up among its customer's jobs", async () => {
    const neverListing = account((url, init) => (init?.method === "POST" ? made(url) : { body: { jobs: [] } }));
    await expect(housecallproCase("work-status-filter").observe(neverListing)).rejects.toThrow("can't tell");
  });
});
