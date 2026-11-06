import { describe, expect, it } from "vitest";
import { loadScenario, loadScenarioByName, runAction } from "../src/control/operations.ts";
import type { JobberState } from "../src/vendors/jobber/types.ts";
import { FIRST_NAMES, LAST_NAMES } from "../src/world/word-lists.ts";
import { setup } from "./helpers.ts";

/** The newClients action: people new to the business, calling in. Their names must stay unique, however many come. */

const clients = (harness: ReturnType<typeof setup>) => [...harness.twin.state<JobberState>("jobber").clients.values()];

describe("Jobber newClients", () => {
  it("never runs out of names: a world that has used every name still gets new clients, each with a unique name and a valid email", async () => {
    const harness = setup();
    loadScenario(harness.twin, 'name: Full\nseed: 3\nstartTime: "2026-07-13T11:00:00Z"\nworld: { customers: 400 }\n'); // every name in the word lists
    await runAction(harness.twin, "jobber", "newClients", 30);
    const everyone = clients(harness);
    const names = everyone.map((client) => `${client.firstName} ${client.lastName}`);
    expect(new Set(names).size).toBe(names.length);
    for (const client of everyone) expect(client.emails[0]!.address).toMatch(/^[a-z0-9.]+@example\.com$/);
  });

  it("doesn't give a new client the name of a person already on file for a company", async () => {
    const harness = setup();
    loadScenario(harness.twin, 'name: One\nseed: 42\nstartTime: "2026-07-13T11:00:00Z"\nworld: { customers: 1 }\n');
    // The office keys in every other name the word lists hold, each with the company the person works for.
    const create = "mutation ($input: ClientCreateInput!) { clientCreate(input: $input) { userErrors { message } } }";
    const taken = new Set(clients(harness).map((client) => `${client.firstName} ${client.lastName}`));
    for (const firstName of FIRST_NAMES) {
      for (const lastName of LAST_NAMES) {
        if (taken.has(`${firstName} ${lastName}`)) continue;
        const body = await (await harness.jobber(create, { input: { firstName, lastName, companyName: `${lastName} Holdings` } })).json();
        expect(body.data.clientCreate.userErrors).toEqual([]);
      }
    }
    await runAction(harness.twin, "jobber", "newClients", 5);
    const names = clients(harness).map((client) => `${client.firstName} ${client.lastName}`);
    expect(new Set(names).size).toBe(names.length);
  });

  it("doesn't give a new client the name of a customer who is only in QuickBooks", async () => {
    const harness = setup();
    loadScenarioByName(harness.twin, "mismatched-books");
    const before = new Set(clients(harness).map((client) => client.id));
    await runAction(harness.twin, "jobber", "newClients", 300);
    const worldNames = new Set(harness.twin.world.customers.map((person) => `${person.firstName} ${person.lastName}`));
    const newcomers = clients(harness).filter((client) => !before.has(client.id));
    expect(newcomers).toHaveLength(300);
    for (const client of newcomers) expect(worldNames.has(`${client.firstName} ${client.lastName}`)).toBe(false);
  });
});
