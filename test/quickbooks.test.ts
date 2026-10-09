import { describe, expect, it } from "vitest";
import { setup } from "./helpers.ts";

describe("QuickBooks twin: customers", () => {
  it("rejects an update that sends an old SyncToken (Stale Object Error)", async () => {
    const { qboGet, qboPost } = setup();
    const { Customer: original } = await (await qboGet("/customer/1")).json();

    // Someone else edits the customer first...
    const first = await qboPost("/customer", { Id: "1", SyncToken: original.SyncToken, sparse: true, DisplayName: "Renamed Once" });
    expect((await first.json()).Customer.SyncToken).toBe("1");

    // ...so our update, still holding SyncToken "0", must fail.
    const second = await qboPost("/customer", { Id: "1", SyncToken: original.SyncToken, sparse: true, DisplayName: "Renamed Twice" });
    expect(second.status).toBe(400);
    expect((await second.json()).Fault.Error[0].code).toBe("5010");
  });

  it("clears fields you leave out of a full (non-sparse) update", async () => {
    const { qboGet, qboPost } = setup();
    const { Customer: original } = await (await qboGet("/customer/2")).json();
    expect(original.PrimaryEmailAddr).toBeDefined();

    const response = await qboPost("/customer", { Id: "2", SyncToken: "0", DisplayName: original.DisplayName });
    const { Customer: updated } = await response.json();
    expect(updated.PrimaryEmailAddr).toBeUndefined(); // the classic silent data-loss bug, reproduced on purpose
  });

  it("pages through customers with STARTPOSITION and MAXRESULTS", async () => {
    const { qboGet } = setup();
    const query = encodeURIComponent("select * from Customer startposition 21 maxresults 10");
    const { QueryResponse } = await (await qboGet(`/query?query=${query}`)).json();
    expect(QueryResponse.Customer).toHaveLength(5); // 25 seeded customers, so positions 21-25
    expect(QueryResponse.startPosition).toBe(21);
  });

  it("injects a QuickBooks-shaped 429 from a fault rule, without touching Jobber", async () => {
    const { twin, qboPost, jobber } = setup();
    twin.faultRules = [{ name: "always-throttle", vendor: "quickbooks", rate: 1, effect: { status: 429 } }];

    const throttled = await qboPost("/customer", { DisplayName: "Anyone" });
    expect(throttled.status).toBe(429);
    expect(throttled.headers.get("X-Twin-Fault")).toBe("always-throttle");
    expect((await throttled.json()).Fault).toBeDefined();

    expect((await jobber("{ account { name } }")).status).toBe(200);
  });
});
