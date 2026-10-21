import { afterEach, describe, expect, it, vi } from "vitest";
import {
  advanceClock,
  createCheckpoint,
  describeTwin,
  loadScenario,
  loadScenarioByName,
  resetTwin,
  setFaults,
} from "../src/control/operations.ts";
import { jobberTwin } from "../src/vendors/jobber/index.ts";
import type { JobberState } from "../src/vendors/jobber/types.ts";
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
    ["more new clients than it can name", scenario('timeline:\n  - at: "+0m"\n    jobber: { newClients: 4294967296 }\n'), "1,000"],
    ["more new customers than it can name", scenario('timeline:\n  - at: "+0m"\n    housecallpro: { newCustomers: 20000 }\n'), "1,000"],
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

describe("a scheduled action that throws when it runs, though its check passed", () => {
  // A stand-in for a bug in a vendor's action: Jobber's newClients, failing whenever it runs.
  const breakNewClients = () =>
    vi.spyOn(jobberTwin.scenarioActions!.newClients!, "run").mockImplementation(() => {
      throw new Error("out of names");
    });
  afterEach(() => vi.restoreAllMocks());

  it("leaves the twin as it was when the action is due at load, and reset still goes back to the scenario before", () => {
    const { twin } = setup();
    loadScenarioByName(twin, "flaky-apis");
    createCheckpoint(twin, "before");
    const clients = () => [...twin.state<JobberState>("jobber").clients.keys()];
    const budget = twin.rateLimit("jobber:test", () => ({ spent: 3 }));
    const before = { status: describeTwin(twin), log: twin.log.toJsonl(), clients: clients() };
    breakNewClients();

    expect(() => loadScenario(twin, scenario('timeline:\n  - at: "+0m"\n    jobber: { newClients: 2 }\n'))).toThrow(
      "jobber newClients at 2026-07-13T11:00:00.000Z failed: out of names",
    );
    expect({ status: describeTwin(twin), log: twin.log.toJsonl(), clients: clients() }).toEqual(before);
    expect(twin.rateLimit("jobber:test", () => ({ spent: 0 }))).toBe(budget);
    expect(resetTwin(twin)).toMatchObject({ scenario: "Flaky APIs", seed: 42, checkpoints: [] });
  });

  it("leaves the twin as it was when a reset meets it, and resets once the action runs again", async () => {
    const { twin } = setup();
    loadScenario(
      twin,
      scenario('timeline:\n  - at: "+0m"\n    jobber: { newClients: 2 }\n  - at: "+2h"\n    jobber: { payInvoices: 1 }\n'),
    );
    await advanceClock(twin, 30);
    createCheckpoint(twin, "later");
    const before = { status: describeTwin(twin), log: twin.log.toJsonl() };
    const run = breakNewClients();

    expect(() => resetTwin(twin)).toThrow("jobber newClients at 2026-07-13T11:00:00.000Z failed: out of names");
    expect({ status: describeTwin(twin), log: twin.log.toJsonl() }).toEqual(before);
    run.mockRestore();
    expect(resetTwin(twin)).toMatchObject({ scenario: "Broken", twinTime: "2026-07-13T11:00:00.000Z", checkpoints: [] });
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

  it("rejects a webhook rule that names paths, since it matches deliveries rather than requests", () => {
    const rule = { name: "late", vendor: "housecallpro", webhook: "*", pathExcludes: "/oauth/", rate: 1, effect: { delayMs: 1000 } };
    expect(() => setFaults(setup().twin, [rule])).toThrow(/pathExcludes/);
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
