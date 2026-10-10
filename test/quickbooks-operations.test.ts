import { describe, expect, it } from "vitest";
import { setup } from "./helpers.ts";

/**
 * QuickBooks writes go to one POST endpoint per entity: a body with an Id updates, one without creates, and
 * `?operation=` names anything else. Intuit's SDKs send `?operation=update` on every update.
 * https://developer.intuit.com/app/developer/qbo/docs/learn/rest-api-features
 */

const sale = (Amount: number) => ({ DetailType: "SalesItemLineDetail", Amount, SalesItemLineDetail: { ItemRef: { value: "1" } } });

describe("QuickBooks twin: ?operation= on writes", () => {
  it("updates a customer or an invoice sent with ?operation=update, as the SDKs send it", async () => {
    const harness = setup();
    const customer = await harness.qboPost("/customer?operation=update", { Id: "1", SyncToken: "0", sparse: true, GivenName: "Updated" });
    expect(customer.status).toBe(200);
    expect((await customer.json()).Customer).toMatchObject({ Id: "1", SyncToken: "1", GivenName: "Updated" });

    const { Invoice } = await (await harness.qboPost("/invoice", { CustomerRef: { value: "1" }, Line: [sale(40)] })).json();
    const update = await harness.qboPost("/invoice?operation=update", { Id: Invoice.Id, SyncToken: "0", sparse: true, PrivateNote: "SDK" });
    expect(update.status).toBe(200);
    expect((await update.json()).Invoice).toMatchObject({ Id: Invoice.Id, PrivateNote: "SDK" });
  });

  it("asks for the Id when ?operation=update comes without one", async () => {
    const response = await setup().qboPost("/customer?operation=update", { DisplayName: "No Id Here" });
    expect(response.status).toBe(400);
    expect((await response.json()).Fault.Error[0]).toMatchObject({ code: "2020", element: "Id" });
  });

  it("refuses ?operation=delete on a customer and changes nothing, rather than treating it as an update", async () => {
    const harness = setup();
    const before = await (await harness.qboGet("/customer/1")).json();
    const response = await harness.qboPost("/customer?operation=delete", { Id: "1", SyncToken: "0", DisplayName: "Gone" });
    expect(response.status).toBe(400);
    expect((await response.json()).Fault.Error[0]).toMatchObject({ code: "500", Message: "Unsupported operation" });
    expect(await (await harness.qboGet("/customer/1")).json()).toEqual(before);
  });

  it("refuses updates and other operations on a payment, which the twin can only create", async () => {
    const harness = setup();
    for (const [path, body] of [
      ["/payment?operation=update", { Id: "1", SyncToken: "0", TotalAmt: 5 }],
      ["/payment", { Id: "1", SyncToken: "0", TotalAmt: 5 }],
      ["/payment?operation=void", { Id: "1", SyncToken: "0" }],
    ] as const) {
      const response = await harness.qboPost(path, body);
      expect((await response.json()).Fault.Error[0]).toMatchObject({ code: "500", Message: "Unsupported operation" });
    }
  });
});
