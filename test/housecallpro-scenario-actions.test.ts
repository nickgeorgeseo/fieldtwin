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

  it("arrive at their time in a scenario, recorded with source scenario", async () => {
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

  it("don't take the name of a customer who is only in the books", async () => {
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

  it("refuse, when the scenario loads, a count that isn't a whole number of 1 or more", () => {
    const harness = setup();
    expect(() => loadScenario(harness.twin, scenario(`  - at: "+1h"\n    housecallpro: { newCustomers: "lots" }`))).toThrow(
      /housecallpro newCustomers takes how many/,
    );
    expect(() => loadScenario(harness.twin, scenario(`  - at: "+1h"\n    housecallpro: { newCustomers: 0 }`))).toThrow(/newCustomers/);
  });
});
