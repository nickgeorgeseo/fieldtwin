import { describe, expect, it } from "vitest";
import { setup } from "./helpers.ts";

/**
 * Error bodies follow the QuickBooks error-code reference:
 * https://developer.intuit.com/app/developer/qbo/docs/develop/troubleshooting/error-codes
 * Its MESSAGE column is the literal <Message>; DETAIL templates like "Query Parser Error: XXX" are filled in.
 */
const firstError = async (response: Response) => {
  const body = await response.json();
  return { status: response.status, type: body.Fault.type, ...body.Fault.Error[0] };
};

describe("QuickBooks twin: error responses", () => {
  it("answers an unknown Id with 610 Object Not Found", async () => {
    const { qboGet } = setup();
    expect(await firstError(await qboGet("/customer/9999"))).toMatchObject({
      status: 400,
      type: "ValidationFault",
      code: "610",
      Message: "Object Not Found",
    });
  });

  it("names the missing parameter in 2020, in the documented wording", async () => {
    const { qboPost } = setup();
    expect(await firstError(await qboPost("/customer", { PrimaryEmailAddr: { Address: "nobody@example.com" } }))).toMatchObject({
      code: "2020",
      Message: "Required param missing, need to supply the required value for the API",
      Detail: "Required parameter DisplayName is missing.",
      element: "DisplayName",
    });
  });

  it("answers a stale SyncToken with 5010 Stale Object", async () => {
    const { qboPost } = setup();
    await qboPost("/customer", { Id: "1", SyncToken: "0", sparse: true, DisplayName: "First Edit" });
    expect(
      await firstError(await qboPost("/customer", { Id: "1", SyncToken: "0", sparse: true, DisplayName: "Second Edit" })),
    ).toMatchObject({
      code: "5010",
      Message: "Stale Object",
    });
  });

  it("rejects a duplicate DisplayName with 6240, naming the customer that already has it", async () => {
    const { qboGet, qboPost } = setup();
    const { Customer: existing } = await (await qboGet("/customer/3")).json();
    expect(await firstError(await qboPost("/customer", { DisplayName: existing.DisplayName }))).toMatchObject({
      code: "6240",
      Message: "Duplicate Name Exists Error",
      Detail: "The specified name already exists. The customer ID is: 3.",
    });
  });

  it("separates queries that cannot be parsed (4000) from parsed queries that are invalid (4001)", async () => {
    const { qboGet } = setup();
    const unparseable = await firstError(await qboGet(`/query?query=${encodeURIComponent("selec * frm Customer")}`));
    expect(unparseable).toMatchObject({ code: "4000", Message: "The query cannot be parsed, refer to detailed message for reasons" });
    expect(unparseable.Detail).toMatch(/^Query Parser Error: /);

    const invalid = await firstError(await qboGet(`/query?query=${encodeURIComponent("select * from Banana")}`));
    expect(invalid).toMatchObject({ code: "4001", Message: "The query is invalid" });
    expect(invalid.Detail).toMatch(/^QueryValidationError: .*Banana/);
  });

  it("answers a missing bearer token with 401 AuthenticationFault 3200", async () => {
    const { app } = setup();
    expect(await firstError(await app.request("/v3/company/9341000000000001/customer/1"))).toMatchObject({
      status: 401,
      type: "AuthenticationFault",
      code: "3200",
    });
  });

  it("answers a request for another company with 403 AuthorizationFault 3100", async () => {
    const { app } = setup();
    const response = await app.request("/v3/company/1234/customer/1", { headers: { Authorization: "Bearer t" } });
    expect(await firstError(response)).toMatchObject({ status: 403, type: "AuthorizationFault", code: "3100" });
  });
});
