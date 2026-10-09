import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { createCheckpoint, listChanges, loadScenario, rewindTo } from "../src/control/operations.ts";
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

  it("loads a scenario: new world size, start time, and faults", () => {
    const { twin } = setup();
    loadScenario(twin, readFileSync("scenarios/heat-wave-monday.yaml", "utf8"));
    expect(twin.world.customers).toHaveLength(120);
    expect(new Set(twin.world.customers.map((c) => `${c.firstName} ${c.lastName}`)).size).toBe(120);
    expect(twin.clock.nowIso()).toBe("2026-07-13T11:00:00.000Z");
    expect(twin.faultRules.map((rule) => rule.name)).toEqual(["qbo-throttled-writes", "jobber-slow"]);
  });
});
