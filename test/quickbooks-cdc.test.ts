import { describe, expect, it } from "vitest";
import { setup } from "./helpers.ts";

/** ChangeDataCapture: https://developer.intuit.com/app/developer/qbo/docs/api/accounting/all-entities/changedatacapture */

type Harness = ReturnType<typeof setup>;
const HOUR = 3_600_000;

const cdc = async (harness: Harness, entities: string, changedSince: string) => {
  const response = await harness.qboGet(`/cdc?entities=${entities}&changedSince=${encodeURIComponent(changedSince)}`);
  return { status: response.status, body: await response.json() };
};
const sale = (Amount: number) => ({ DetailType: "SalesItemLineDetail", Amount, SalesItemLineDetail: { ItemRef: { value: "1" } } });

describe("QuickBooks twin: change data capture", () => {
  it("returns what changed since a time, grouped by entity, as full records", async () => {
    const harness = setup();
    harness.twin.clock.advance(HOUR);
    await harness.qboPost("/customer", { DisplayName: "New Since Morning" });
    harness.twin.clock.advance(HOUR);
    await harness.qboPost("/invoice", { CustomerRef: { value: "2" }, Line: [sale(80)] });

    const { status, body } = await cdc(harness, "Customer,Invoice", "2026-07-13T11:30:00Z");
    expect(status).toBe(200);
    const [customers, invoices] = body.CDCResponse[0].QueryResponse;
    expect(customers).toMatchObject({ startPosition: 1, maxResults: 1, Customer: [{ DisplayName: "New Since Morning", domain: "QBO" }] });
    expect(invoices).toMatchObject({ startPosition: 1, maxResults: 1, Invoice: [{ TotalAmt: 80, Line: expect.any(Array) }] });
  });

  it("returns a record once, in its latest version, however often it changed", async () => {
    const harness = setup();
    harness.twin.clock.advance(HOUR);
    await harness.qboPost("/customer", { Id: "5", SyncToken: "0", sparse: true, DisplayName: "Renamed Once" });
    await harness.qboPost("/customer", { Id: "5", SyncToken: "1", sparse: true, DisplayName: "Renamed Twice" });
    const { body } = await cdc(harness, "Customer", "2026-07-13T11:00:00Z");
    expect(body.CDCResponse[0].QueryResponse[0].Customer).toEqual([
      expect.objectContaining({ Id: "5", SyncToken: "2", DisplayName: "Renamed Twice" }),
    ]);
  });

  it("orders each group by last updated time", async () => {
    const harness = setup();
    harness.twin.clock.advance(HOUR);
    await harness.qboPost("/customer", { Id: "9", SyncToken: "0", sparse: true, GivenName: "Later" });
    harness.twin.clock.advance(HOUR);
    await harness.qboPost("/customer", { Id: "3", SyncToken: "0", sparse: true, GivenName: "Latest" });
    const { body } = await cdc(harness, "Customer", "2026-07-13T11:00:00Z");
    expect(body.CDCResponse[0].QueryResponse[0].Customer.map((c: { Id: string }) => c.Id)).toEqual(["9", "3"]);
  });

  it("leaves out what changed before changedSince, and answers an empty group when nothing did", async () => {
    const harness = setup();
    await harness.qboPost("/customer", { DisplayName: "Too Early" });
    harness.twin.clock.advance(2 * HOUR);
    const { body } = await cdc(harness, "Customer,Payment", "2026-07-13T12:00:00Z");
    expect(body.CDCResponse[0].QueryResponse).toEqual([{}, {}]);
  });

  it("accepts the documented date-only and UTC-offset formats for changedSince", async () => {
    const harness = setup();
    harness.twin.clock.advance(HOUR);
    await harness.qboPost("/customer", { DisplayName: "Offset Check" });
    for (const since of ["2026-07-13", "2026-07-13T04:00:00-0700", "2026-07-13T04:00:00-07:00"]) {
      const { body } = await cdc(harness, "Customer", since);
      expect(body.CDCResponse[0].QueryResponse[0].Customer).toHaveLength(1);
    }
  });

  it("reads a changedSince without a UTC offset as UTC, whatever time zone the twin's machine is in", async () => {
    const machineZone = process.env.TZ;
    process.env.TZ = "America/Los_Angeles"; // 2026-07-13T11:30:00 there would be 18:30 UTC
    try {
      const harness = setup();
      harness.twin.clock.advance(HOUR);
      await harness.qboPost("/customer", { DisplayName: "Changed At Noon UTC" });
      const before = await cdc(harness, "Customer", "2026-07-13T11:30:00");
      expect(before.body.CDCResponse[0].QueryResponse[0].Customer).toHaveLength(1);
      const after = await cdc(harness, "Customer", "2026-07-13T12:30:00");
      expect(after.body.CDCResponse[0].QueryResponse).toEqual([{}]);
    } finally {
      if (machineZone === undefined) delete process.env.TZ;
      else process.env.TZ = machineZone;
    }
  });

  it("refuses a changedSince that isn't a day the calendar has, rather than rolling it into the next month", async () => {
    const { status, body } = await cdc(setup(), "Customer", "2026-02-30");
    expect(status).toBe(400);
    expect(body.Fault.Error[0]).toMatchObject({ code: "2070", Message: "Invalid Date", element: "changedSince" });
  });

  it("refuses to look back more than 30 days", async () => {
    const { status, body } = await cdc(setup(), "Customer", "2026-06-01T00:00:00Z");
    expect(status).toBe(400);
    expect(body.Fault.Error[0]).toMatchObject({ code: "2190", element: "changedSince" });
  });

  it("requires entities and changedSince, and names entities it doesn't model", async () => {
    const harness = setup();
    const noEntities = await harness.qboGet("/cdc?changedSince=2026-07-13");
    expect((await noEntities.json()).Fault.Error[0]).toMatchObject({ code: "2020", element: "entities" });
    const noSince = await harness.qboGet("/cdc?entities=Customer");
    expect((await noSince.json()).Fault.Error[0]).toMatchObject({ code: "2020", element: "changedSince" });
    const { body } = await cdc(harness, "Customer,Estimate", "2026-07-13");
    expect(body.Fault.Error[0]).toMatchObject({ code: "500" });
    expect(body.Fault.Error[0].Detail).toContain("Estimate");
  });
});
