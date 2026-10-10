import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { loadScenario } from "../src/control/operations.ts";
import { SeededRandom } from "../src/core/random.ts";
import { generateWorld } from "../src/world/generate-world.ts";
import { setup } from "./helpers.ts";

const START = "2026-07-13T11:00:00.000Z";
const drift = { renamedInAccounting: 3, fieldServiceOnly: 2, accountingOnly: 2, inactiveInAccounting: 1 };
const WEEK = 7 * 86_400_000;
const driftedWorld = () => generateWorld(new SeededRandom(21), { startTime: START, size: { customers: 30 }, drift });

/** A twin loaded with the mismatched-books scenario. */
function mismatched() {
  const harness = setup();
  loadScenario(harness.twin, readFileSync("scenarios/mismatched-books.yaml", "utf8"));
  return harness;
}

const qboCustomersByEmail = async (harness: ReturnType<typeof setup>, email: string) =>
  (await (await harness.qboGet(`/query?query=${encodeURIComponent(`select * from Customer where PrimaryEmailAddr = '${email}'`)}`)).json())
    .QueryResponse.Customer ?? [];

describe("drift between the field-service and accounting systems", () => {
  it("leaves worlds without drift exactly as they were", () => {
    const plain = generateWorld(new SeededRandom(21), { startTime: START, size: { customers: 30 } });
    expect(plain.drift).toEqual({ accountingSpellings: {}, fieldServiceOnly: [], accountingOnly: [], inactiveInAccounting: [] });
    expect(generateWorld(new SeededRandom(21), { startTime: START, size: { customers: 30 }, drift: {} })).toEqual(plain);
  });

  it("gives every customer who is only in the field-service system work the books have never seen, whatever the seed", () => {
    for (let seed = 1; seed <= 200; seed++) {
      const world = generateWorld(new SeededRandom(seed), { startTime: START, size: { customers: 30 }, drift });
      for (const key of world.drift.fieldServiceOnly) {
        expect(
          world.history.jobs.some((job) => job.customerKey === key),
          `seed ${seed}: ${key} has a job`,
        ).toBe(true);
        expect(
          world.history.invoices.some((invoice) => invoice.customerKey === key),
          `seed ${seed}: ${key} has an invoice`,
        ).toBe(true);
      }
    }
  });

  it("gives every customer the books made inactive a job paid in the last week, newer than the books, whatever the seed", () => {
    for (let seed = 1; seed <= 200; seed++) {
      const world = generateWorld(new SeededRandom(seed), { startTime: START, size: { customers: 30 }, drift });
      expect(world.drift.inactiveInAccounting).toHaveLength(1);
      for (const key of world.drift.inactiveInAccounting) {
        const recentlyPaid = world.history.invoices.filter(
          (invoice) =>
            invoice.customerKey === key &&
            invoice.paidAt !== undefined &&
            Date.parse(invoice.issuedAt) >= Date.parse(START) - WEEK &&
            Date.parse(invoice.paidAt) <= Date.parse(START),
        );
        expect(recentlyPaid.length, `seed ${seed}: ${key} paid for work this week`).toBeGreaterThan(0);
      }
    }
  });

  it("chooses distinct customers for each kind of drift, and respells names plausibly", () => {
    const world = driftedWorld();
    const renamed = Object.keys(world.drift.accountingSpellings);
    expect(renamed).toHaveLength(3);
    expect(world.drift.fieldServiceOnly).toHaveLength(2);
    expect(world.drift.accountingOnly).toHaveLength(2);
    expect(world.drift.inactiveInAccounting).toHaveLength(1);
    const chosen = [...renamed, ...world.drift.fieldServiceOnly, ...world.drift.accountingOnly, ...world.drift.inactiveInAccounting];
    expect(new Set(chosen).size).toBe(8);

    for (const [key, spelling] of Object.entries(world.drift.accountingSpellings)) {
      const customer = world.customers.find((candidate) => candidate.key === key)!;
      expect(`${spelling.firstName} ${spelling.lastName}`).not.toBe(`${customer.firstName} ${customer.lastName}`);
      // One letter or so apart: the kind of difference that defeats exact matching, not a different person.
      expect(Math.abs(spelling.lastName.length - customer.lastName.length)).toBeLessThanOrEqual(2);
    }
  });

  it("never gives accounting-only customers any field work", () => {
    const world = driftedWorld();
    for (const job of world.history.jobs) expect(world.drift.accountingOnly).not.toContain(job.customerKey);
  });

  it("spells renamed customers differently in QuickBooks, with the same email as in Jobber", async () => {
    const harness = mismatched();
    const { world } = harness.twin;
    for (const [key, spelling] of Object.entries(world.drift.accountingSpellings)) {
      const person = world.customers.find((customer) => customer.key === key)!;
      const [inQbo] = await qboCustomersByEmail(harness, person.email);
      expect(inQbo).toMatchObject({ GivenName: spelling.firstName, FamilyName: spelling.lastName });
      expect(inQbo.DisplayName).not.toBe(`${person.firstName} ${person.lastName}`);
    }
  });

  it("keeps field-service-only customers, and their invoices, out of QuickBooks", async () => {
    const harness = mismatched();
    const { world } = harness.twin;
    for (const key of world.drift.fieldServiceOnly) {
      const person = world.customers.find((customer) => customer.key === key)!;
      expect(await qboCustomersByEmail(harness, person.email)).toEqual([]);
      const qbo = harness.twin.state<{ invoices: Map<string, { CustomerRef: { name?: string } }> }>("quickbooks");
      for (const invoice of qbo.invoices.values()) expect(invoice.CustomerRef.name).not.toBe(`${person.firstName} ${person.lastName}`);
    }
  });

  it("keeps accounting-only customers out of Jobber", async () => {
    const harness = mismatched();
    const { world } = harness.twin;
    const body = await (await harness.jobber("{ clients(first: 100) { totalCount nodes { email } } }")).json();
    expect(body.data.clients.totalCount).toBe(world.customers.length - world.drift.accountingOnly.length);
    for (const key of world.drift.accountingOnly) {
      const person = world.customers.find((customer) => customer.key === key)!;
      expect(body.data.clients.nodes.map((client: { email: string }) => client.email)).not.toContain(person.email);
      expect(await qboCustomersByEmail(harness, person.email)).toHaveLength(1);
    }
  });

  it("has QuickBooks keep the customers it made inactive, out of default queries, without the work paid since", async () => {
    const harness = mismatched();
    const { world } = harness.twin;
    expect(world.drift.inactiveInAccounting.length).toBeGreaterThan(0);
    const qbo = harness.twin.state<{ invoices: Map<string, { DocNumber?: string }> }>("quickbooks");
    const jobber = harness.twin.state<{
      clients: Map<string, { id: string; emails: { address: string }[] }>;
      invoices: Map<string, { clientId: string; invoiceNumber: string; paidAt?: string }>;
    }>("jobber");
    for (const key of world.drift.inactiveInAccounting) {
      const person = world.customers.find((customer) => customer.key === key)!;
      expect(await qboCustomersByEmail(harness, person.email)).toEqual([]); // left out unless a query asks for inactive ones
      const query = `select * from Customer where PrimaryEmailAddr = '${person.email}' and Active = false`;
      const [inactive] = (await (await harness.qboGet(`/query?query=${encodeURIComponent(query)}`)).json()).QueryResponse.Customer;
      expect(inactive).toMatchObject({ Active: false });

      const client = [...jobber.clients.values()].find((candidate) => candidate.emails[0]?.address === person.email)!;
      const booked = new Set([...qbo.invoices.values()].map((invoice) => invoice.DocNumber));
      const paidSince = [...jobber.invoices.values()].filter(
        (invoice) => invoice.clientId === client.id && invoice.paidAt && !booked.has(invoice.invoiceNumber),
      );
      expect(paidSince.length).toBeGreaterThan(0);
    }
  });
});
