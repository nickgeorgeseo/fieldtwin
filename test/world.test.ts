import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { SeededRandom } from "../src/core/random.ts";
import { generateWorld } from "../src/world/generate-world.ts";

const START = "2026-07-13T11:00:00.000Z";
const world = (seed: number, size?: { customers?: number; technicians?: number }) =>
  generateWorld(new SeededRandom(seed), { startTime: START, size });
/** The people and the business as the first version of the generator made them. New fields don't change it. */
const fingerprint = (seed: number) => {
  const { company, customers, technicians } = world(seed);
  const { name, trade, city, state } = company;
  const people = { company: { name, trade, city, state }, customers, technicians };
  return createHash("sha256").update(JSON.stringify(people)).digest("hex").slice(0, 16);
};

describe("the world generator", () => {
  it("keeps the customers and technicians existing seeds already produce", () => {
    // New world features must draw their randomness after everything that came before them, so a
    // bug report that says "seed 42" still means the same company, customers, and technicians.
    expect(fingerprint(42)).toBe("f0943f9aa547f933"); // Rowntree Electric
    expect(fingerprint(7)).toBe("92c311d048c6cca4"); // Thorne Heating & Air
  });

  it("gives the business a price list for its own trade", () => {
    const electrician = world(42);
    expect(electrician.company.trade).toBe("electrical");
    const names = electrician.catalog.map((entry) => entry.name);
    expect(names).toContain("Panel inspection");
    expect(names).not.toContain("AC tune-up");

    const hvac = world(7);
    expect(hvac.catalog.map((entry) => entry.name)).toContain("AC tune-up");
  });

  it("mixes services and parts, with plausible prices in whole dollars", () => {
    const { catalog } = world(42);
    expect(catalog.some((entry) => entry.kind === "service")).toBe(true);
    expect(catalog.some((entry) => entry.kind === "part")).toBe(true);
    for (const entry of catalog) {
      expect(entry.unitPrice).toBeGreaterThan(0);
      expect(Number.isInteger(entry.unitPrice)).toBe(true);
    }
  });

  it("uses names every vendor accepts: unique, and free of colons, tabs, and newlines", () => {
    // QuickBooks Item names "must be unique ... and cannot include tabs, new lines, or colons".
    for (const seed of [1, 7, 42, 99]) {
      const names = world(seed).catalog.map((entry) => entry.name);
      expect(new Set(names).size).toBe(names.length);
      for (const name of names) expect(name).not.toMatch(/[:\t\n]/);
    }
  });

  it("prices the same seed the same way every time, and different seeds differently", () => {
    expect(world(42).catalog).toEqual(world(42).catalog);
    const prices = (seed: number) => world(seed).catalog.map((entry) => entry.unitPrice);
    const electricalSeeds = [42, 1, 2, 3, 4, 5, 6, 8].filter((seed) => world(seed).company.trade === "electrical");
    expect(new Set(electricalSeeds.map((seed) => prices(seed).join(","))).size).toBeGreaterThan(1);
  });
});

describe("the world's history", () => {
  const startMs = Date.parse(START);
  const { history, customers, technicians, catalog } = world(42);
  const allVisits = history.jobs.flatMap((job) => job.visits);
  const totalOf = (lines: { quantity: number; unitPrice: number }[]) =>
    Math.round(lines.reduce((sum, line) => sum + line.quantity * line.unitPrice, 0) * 100) / 100;

  it("has finished work, work on the schedule, and invoices still waiting to be paid", () => {
    expect(history.jobs.filter((job) => job.visits.every((visit) => visit.completedAt)).length).toBeGreaterThan(20);
    expect(allVisits.filter((visit) => Date.parse(visit.startAt) > startMs).length).toBeGreaterThan(3);
    expect(history.invoices.filter((invoice) => !invoice.paidAt).length).toBeGreaterThan(2);
    expect(history.invoices.filter((invoice) => invoice.paidAt).length).toBeGreaterThan(10);
  });

  it("puts work on today's board, and leaves some invoices past due", () => {
    const today = START.slice(0, 10);
    expect(allVisits.filter((visit) => visit.startAt.startsWith(today) && !visit.completedAt).length).toBeGreaterThanOrEqual(2);
    expect(history.invoices.filter((invoice) => !invoice.paidAt && Date.parse(invoice.dueAt) < startMs).length).toBeGreaterThan(0);
  });

  it("titles jobs the way a dispatcher would, not after a billing unit", () => {
    for (const job of history.jobs) expect(job.title).not.toMatch(/\(per /);
  });

  it("keeps completed visits in the past and upcoming visits in the future", () => {
    for (const visit of allVisits) {
      if (visit.completedAt) expect(Date.parse(visit.completedAt)).toBeLessThanOrEqual(startMs);
      else expect(Date.parse(visit.startAt)).toBeGreaterThan(startMs);
      expect(Date.parse(visit.endAt)).toBeGreaterThan(Date.parse(visit.startAt));
    }
  });

  it("books visits during business hours in the company's time zone", () => {
    for (const visit of allVisits) {
      const localHour = (new Date(visit.startAt).getUTCHours() + 24 + world(42).company.utcOffsetHours) % 24;
      expect(localHour).toBeGreaterThanOrEqual(7);
      expect(localHour).toBeLessThanOrEqual(16);
    }
  });

  it("spreads visits across every technician", () => {
    const assigned = new Set(allVisits.flatMap((visit) => visit.technicianKeys));
    expect([...assigned].sort()).toEqual(technicians.map((technician) => technician.key).sort());
  });

  it("prices every line from the catalog, and invoices total exactly what their job's lines add up to", () => {
    const catalogKeys = new Set(catalog.map((entry) => entry.key));
    for (const job of history.jobs) {
      for (const line of job.lineItems) expect(catalogKeys.has(line.catalogKey)).toBe(true);
    }
    for (const invoice of history.invoices) {
      const job = history.jobs.find((candidate) => candidate.key === invoice.jobKey)!;
      expect(invoice.lineItems).toEqual(job.lineItems);
      expect(totalOf(invoice.lineItems)).toBeGreaterThan(20);
      expect(totalOf(invoice.lineItems)).toBeLessThan(5000);
    }
  });

  it("always leaves the most recently finished job waiting to be invoiced", () => {
    const finished = history.jobs.filter((job) => job.visits.every((visit) => visit.completedAt));
    const latest = finished.reduce((a, b) => (a.visits.at(-1)!.completedAt! > b.visits.at(-1)!.completedAt! ? a : b));
    expect(history.invoices.some((invoice) => invoice.jobKey === latest.key)).toBe(false);
  });

  it("invoices completed jobs only, and pays invoices after issuing them and before today", () => {
    for (const invoice of history.invoices) {
      const job = history.jobs.find((candidate) => candidate.key === invoice.jobKey)!;
      expect(job.visits.every((visit) => visit.completedAt)).toBe(true);
      expect(Date.parse(invoice.issuedAt)).toBeLessThanOrEqual(startMs);
      if (invoice.paidAt) {
        expect(Date.parse(invoice.paidAt)).toBeGreaterThanOrEqual(Date.parse(invoice.issuedAt));
        expect(Date.parse(invoice.paidAt)).toBeLessThanOrEqual(startMs);
      }
    }
  });

  it("quotes bigger work first, and leaves some quotes waiting for an answer", () => {
    expect(history.quotes.filter((quote) => quote.jobKey).length).toBeGreaterThan(0);
    expect(history.quotes.filter((quote) => !quote.approvedAt).length).toBeGreaterThan(0);
    for (const quote of history.quotes) {
      if (quote.jobKey) {
        const job = history.jobs.find((candidate) => candidate.key === quote.jobKey)!;
        expect(job.quoteKey).toBe(quote.key);
        expect(Date.parse(quote.createdAt)).toBeLessThan(Date.parse(job.createdAt));
      }
    }
  });

  it("numbers jobs, quotes, and invoices in date order, and only for known customers", () => {
    const customerKeys = new Set(customers.map((customer) => customer.key));
    for (const list of [history.jobs, history.quotes, history.invoices]) {
      expect(list.map((record) => record.number)).toEqual(list.map((_, index) => index + 1));
      const dates = list.map((record) => Date.parse(record.createdAt));
      expect(dates).toEqual([...dates].sort((a, b) => a - b));
      for (const record of list) expect(customerKeys.has(record.customerKey)).toBe(true);
    }
  });

  it("scales with the size of the business", () => {
    const small = world(42, { customers: 10 }).history.jobs.length;
    const large = world(42, { customers: 120 }).history.jobs.length;
    expect(large).toBeGreaterThan(small * 4);
  });
});
