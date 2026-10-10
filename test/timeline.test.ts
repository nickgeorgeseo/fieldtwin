import { describe, expect, it } from "vitest";
import { advanceClock, createCheckpoint, describeTwin, listChanges, loadScenario, rewindTo } from "../src/control/operations.ts";
import { setup } from "./helpers.ts";

const scenario = (timeline: string) => `
name: Busy morning
seed: 42
startTime: "2026-07-13T11:00:00Z"
timeline:
${timeline}
`;

type Harness = ReturnType<typeof setup>;
const clientCount = async (harness: Harness) =>
  (await (await harness.jobber("{ clients(first: 1) { totalCount } }")).json()).data.clients.totalCount;

describe("scenario timelines", () => {
  it("applies scheduled events as twin time reaches them, recorded with source scenario", async () => {
    const harness = setup();
    loadScenario(harness.twin, scenario(`  - at: "+1h"\n    jobber: { newClients: 3 }`));
    createCheckpoint(harness.twin, "loaded");
    expect(await clientCount(harness)).toBe(25);

    await advanceClock(harness.twin, 30);
    expect(await clientCount(harness)).toBe(25);
    await advanceClock(harness.twin, 30);
    expect(await clientCount(harness)).toBe(28);

    const changes = listChanges(harness.twin, "loaded");
    expect(changes.map((change) => [change.type, change.source, change.at])).toEqual([
      ["ClientCreated", "scenario", "2026-07-13T12:00:00.000Z"],
      ["ClientCreated", "scenario", "2026-07-13T12:00:00.000Z"],
      ["ClientCreated", "scenario", "2026-07-13T12:00:00.000Z"],
    ]);
  });

  it("understands +offsets, the business's local HH:MM, and ISO times, and runs each at its own time", async () => {
    const harness = setup();
    // Seed 42's business is in Texas (UTC-5 in summer), so 09:00 local is 14:00 UTC.
    loadScenario(
      harness.twin,
      scenario(
        [
          `  - at: "2026-07-13T16:00:00Z"\n    jobber: { newClients: 1 }`,
          `  - at: "09:00"\n    jobber: { newClients: 1 }`,
          `  - at: "+90m"\n    jobber: { newClients: 1 }`,
        ].join("\n"),
      ),
    );
    createCheckpoint(harness.twin, "loaded");
    await advanceClock(harness.twin, 8 * 60);
    expect(listChanges(harness.twin, "loaded").map((change) => change.at)).toEqual([
      "2026-07-13T12:30:00.000Z",
      "2026-07-13T14:00:00.000Z",
      "2026-07-13T16:00:00.000Z",
    ]);
    expect(harness.twin.clock.nowIso()).toBe("2026-07-13T19:00:00.000Z");
  });

  it("re-arms events after a rewind to before them, without ever applying them twice", async () => {
    const harness = setup();
    loadScenario(harness.twin, scenario(`  - at: "+1h"\n    jobber: { newClients: 2 }`));
    createCheckpoint(harness.twin, "start");
    await advanceClock(harness.twin, 120);
    expect(listChanges(harness.twin, "start")).toHaveLength(2);

    rewindTo(harness.twin, "start");
    expect(listChanges(harness.twin, "start")).toHaveLength(0);
    await advanceClock(harness.twin, 120);
    expect(listChanges(harness.twin, "start")).toHaveLength(2);
  });

  it("pays the oldest open Jobber invoices with payInvoices", async () => {
    const harness = setup();
    loadScenario(harness.twin, scenario(`  - at: "+1h"\n    jobber: { payInvoices: 2 }`));
    const open = async () =>
      (
        await (await harness.jobber("{ invoices(first: 50) { nodes { invoiceNumber invoiceStatus updatedAt } } }")).json()
      ).data.invoices.nodes.filter((invoice: { invoiceStatus: string }) => invoice.invoiceStatus !== "paid");
    const before = await open();
    await advanceClock(harness.twin, 60);
    const after = await open();
    expect(after).toHaveLength(before.length - 2);

    const paid = before.filter(
      (invoice: { invoiceNumber: string }) => !after.some((o: { invoiceNumber: string }) => o.invoiceNumber === invoice.invoiceNumber),
    );
    const { invoices } = (
      await (await harness.jobber("{ invoices(first: 50) { nodes { invoiceNumber invoiceStatus updatedAt } } }")).json()
    ).data;
    for (const { invoiceNumber } of paid) {
      expect(invoices.nodes.find((invoice: { invoiceNumber: string }) => invoice.invoiceNumber === invoiceNumber)).toMatchObject({
        invoiceStatus: "paid",
        updatedAt: "2026-07-13T12:00:00.000Z",
      });
    }
  });

  it("produces the same log from the same scenario, every time", async () => {
    const run = async () => {
      const harness = setup();
      loadScenario(harness.twin, scenario(`  - at: "+1h"\n    jobber: { newClients: 5, payInvoices: 1 }`));
      await advanceClock(harness.twin, 90);
      return harness.twin.log.toJsonl();
    };
    expect(await run()).toBe(await run());
  });

  it("shows what is scheduled next", () => {
    const harness = setup();
    loadScenario(harness.twin, scenario(`  - at: "+1h"\n    jobber: { newClients: 3, payInvoices: 1 }`));
    expect(describeTwin(harness.twin).upcoming).toEqual([
      { at: "2026-07-13T12:00:00.000Z", vendor: "jobber", action: "newClients", params: 3 },
      { at: "2026-07-13T12:00:00.000Z", vendor: "jobber", action: "payInvoices", params: 1 },
    ]);
  });

  it("names the problem when a scenario schedules something the twin can't do", () => {
    const harness = setup();
    expect(() => loadScenario(harness.twin, scenario(`  - at: "+1h"\n    jobber: { teleportTechnicians: 1 }`))).toThrow(
      'jobber has no scenario action "teleportTechnicians". Available: newClients, payInvoices',
    );
    expect(() => loadScenario(harness.twin, scenario(`  - at: "+1h"\n    quickbooks: { newClients: 1 }`))).toThrow(
      /quickbooks has no scenario action/,
    );
    expect(() => loadScenario(harness.twin, scenario(`  - at: "lunchtime"\n    jobber: { newClients: 1 }`))).toThrow(/"lunchtime"/);
    expect(() => loadScenario(harness.twin, scenario(`  - at: "+1h"\n    jobber: { newClients: -2 }`))).toThrow(/newClients/);
  });
});
