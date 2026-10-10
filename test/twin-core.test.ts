import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { ALL_VENDORS } from "../src/app.ts";
import { createCheckpoint, listChanges, loadScenario, rewindTo } from "../src/control/operations.ts";
import { VENDOR_NAMES } from "../src/core/types.ts";
import { setup } from "./helpers.ts";

describe("the twin", () => {
  it("builds the same world, byte for byte, from the same seed", () => {
    expect(setup(42).twin.log.toJsonl()).toBe(setup(42).twin.log.toJsonl());
    expect(setup(42).twin.log.toJsonl()).not.toBe(setup(43).twin.log.toJsonl());
  });

  it("lists what the code under test changed, and can rewind it", async () => {
    const { twin, qboPost } = setup();
    createCheckpoint(twin, "before-sync");

    await qboPost("/customer", { DisplayName: "Brand New Customer" });
    const changes = listChanges(twin, "before-sync", { onlyFromApi: true });
    expect(changes.map((change) => change.type)).toEqual(["CustomerCreated"]);
    expect(changes[0]!.summary).toContain("Brand New Customer");

    rewindTo(twin, "before-sync");
    expect(listChanges(twin, "before-sync")).toEqual([]);
  });

  it("summarizes each change in one line, in the vendor's own words", async () => {
    const { twin, qboGet, qboPost } = setup();
    const { Customer } = await (await qboGet("/customer/1")).json();
    createCheckpoint(twin, "before");
    await qboPost("/customer", { Id: "1", SyncToken: "0", sparse: true, DisplayName: "Renamed Customer" });

    const [change] = listChanges(twin, "before");
    expect(change!.summary).toBe(`2026-07-13T11:00:00.000Z  quickbooks  CustomerUpdated Id=1 "Renamed Customer" SyncToken=1  (api)`);
    expect(Customer.DisplayName).not.toBe("Renamed Customer");

    // Every vendor describes its own events; control/ never looks inside a payload.
    const firstClient = twin.log.all().find((event) => event.type === "ClientCreated")!;
    expect(twin.vendor("jobber").describeEvent(firstClient)).toMatch(/^ClientCreated "[A-Z][a-z]+ [A-Z][a-z]+"$/);
  });

  it("loads a scenario: new world size, start time, and faults", () => {
    const { twin } = setup();
    loadScenario(twin, readFileSync("scenarios/heat-wave-monday.yaml", "utf8"));
    expect(twin.world.customers).toHaveLength(120);
    expect(new Set(twin.world.customers.map((c) => `${c.firstName} ${c.lastName}`)).size).toBe(120);
    expect(twin.clock.nowIso()).toBe("2026-07-13T11:00:00.000Z");
    expect(twin.faultRules.map((rule) => rule.name)).toEqual(["qbo-throttled-writes", "jobber-slow"]);
    expect(twin.upcoming().map((entry) => `${entry.action} ${entry.params}`)).toEqual(["newClients 12", "newClients 15", "payInvoices 4"]);
  });
});

describe("the control plane over HTTP", () => {
  it("lists ready-made scenarios and loads one by name", async () => {
    const { app, twin } = setup();
    const scenarios = await (await app.request("/_twin/scenarios")).json();
    expect(scenarios.map((scenario: { name: string }) => scenario.name)).toContain("mismatched-books");

    const loaded = await (await app.request("/_twin/scenarios/mismatched-books", { method: "POST" })).json();
    expect(loaded.scenario).toBe("Mismatched books");
    expect(twin.world.customers).toHaveLength(30);

    const missing = await app.request("/_twin/scenarios/no-such-thing", { method: "POST" });
    expect(missing.status).toBe(400);
    expect((await missing.json()).error).toContain("Available:");
  });

  it("exports the log since a checkpoint", async () => {
    const { app, qboPost } = setup();
    await app.request("/_twin/checkpoints/mark", { method: "POST" });
    await qboPost("/customer", { DisplayName: "Exported Customer" });
    const lines = (await (await app.request("/_twin/log.jsonl?since=mark")).text()).split("\n");
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain("Exported Customer");
  });
});

describe("the list of vendors", () => {
  it("names exactly the vendors app.ts serves, so scenarios and fault rules accept every one of them", () => {
    expect(ALL_VENDORS.map((vendor) => vendor.name).sort()).toEqual([...VENDOR_NAMES].sort());
  });
});
