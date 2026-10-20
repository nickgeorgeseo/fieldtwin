import { describe, expect, it } from "vitest";
import { describeTwin, loadScenario, loadScenarioByName, resetTwin, setFaults } from "../src/control/operations.ts";
import { setup } from "./helpers.ts";

/**
 * Loading a scenario is all or nothing: one that fails to load leaves the twin exactly as it was, and says what to
 * fix. A scenario means the same moments on every machine, and a typo is an error, never a rule silently ignored.
 */

const scenario = (lines: string) => `name: Broken\nseed: 7\nstartTime: "2026-07-13T11:00:00Z"\n${lines}`;

describe("loading a scenario that is wrong", () => {
  it.each([
    ["a start time that isn't a time", 'name: Broken\nseed: 7\nstartTime: "next tuesday"\n', "startTime"],
    ["a start time without a UTC offset", 'name: Broken\nseed: 7\nstartTime: "2026-07-13T08:00:00"\n', "UTC offset"],
    ["a timeline time it can't read", scenario('timeline:\n  - at: "noon"\n    jobber: { newClients: 1 }\n'), "noon"],
    ["a timeline time far beyond any date", scenario('timeline:\n  - at: "+999999999d"\n    jobber: { newClients: 1 }\n'), "+999999999d"],
    ["a timeline action with bad parameters", scenario('timeline:\n  - at: "+1h"\n    jobber: { newClients: "lots" }\n'), "newClients"],
    ["an action named as every object's own", scenario('timeline:\n  - at: "+1h"\n    housecallpro: { constructor: 1 }\n'), "constructor"],
    ["a world too big to name", scenario("world: { customers: 1000 }\n"), "customers"],
    ["a key it doesn't know", scenario("fault:\n  - { name: x, vendor: jobber, rate: 1, effect: { status: 503 } }\n"), "fault"],
  ])("leaves the twin as it was, given %s", (_label, yaml, says) => {
    const { twin } = setup();
    loadScenarioByName(twin, "flaky-apis");
    const before = { status: describeTwin(twin), log: twin.log.all() };
    expect(() => loadScenario(twin, yaml)).toThrow(says);
    expect({ status: describeTwin(twin), log: twin.log.all() }).toEqual(before);
    expect(() => resetTwin(twin)).not.toThrow();
  });
});

describe("fault rules", () => {
  it("rejects a key it doesn't know, rather than dropping it and faulting every request", () => {
    const { twin } = setup();
    const outage = { name: "invoice-outage", vendor: "quickbooks", path: "/invoice", rate: 1, effect: { status: 503 } };
    expect(() => setFaults(twin, [outage])).toThrow(/path/);
    expect(twin.faultRules).toEqual([]);
  });

  it("rejects a misspelled effect, which would otherwise do nothing", () => {
    expect(() => setFaults(setup().twin, [{ name: "typo", vendor: "jobber", rate: 1, effect: { staus: 503 } }])).toThrow(/staus/);
  });

  it("rejects a request rule with no status or latency, which could never do anything", () => {
    expect(() => setFaults(setup().twin, [{ name: "idle", vendor: "jobber", rate: 1, effect: { message: "hi" } }])).toThrow(
      /status or latencyMs/,
    );
  });

  it("rejects a webhook rule for a topic the vendor never sends, naming the ones it does", () => {
    const rule = { name: "late", vendor: "jobber", webhook: "INVOICE_UPDATED", rate: 1, effect: { delayMs: 1000 } };
    expect(() => setFaults(setup().twin, [rule])).toThrow(/INVOICE_UPDATED.*INVOICE_UPDATE/);
  });
});

describe("resetting and switching scenarios", () => {
  it("resets to the start of the loaded scenario, faults and all, so each test in a run starts the same", () => {
    const { twin } = setup();
    const loaded = loadScenarioByName(twin, "flaky-apis");
    setFaults(twin, []); // a test switches them off for a while
    const reset = resetTwin(twin);
    expect(reset.activeFaults).toEqual(loaded.activeFaults);
    expect(reset.activeFaults.length).toBeGreaterThan(0);
    expect(reset.upcoming).toEqual(loaded.upcoming);
  });

  it("goes back to the twin's own auth mode when the next scenario doesn't set one", () => {
    const anyToken = setup().twin;
    loadScenarioByName(anyToken, "flaky-apis"); // auth: oauth
    expect(loadScenarioByName(anyToken, "heat-wave-monday").authMode).toBe("any-token");

    const startedStrict = setup(42, { auth: "oauth" }).twin; // FIELDTWIN_AUTH=oauth
    expect(loadScenarioByName(startedStrict, "heat-wave-monday").authMode).toBe("oauth");
  });
});
