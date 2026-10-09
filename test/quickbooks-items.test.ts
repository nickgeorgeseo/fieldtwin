import { describe, expect, it } from "vitest";
import { setup } from "./helpers.ts";

/** Item: https://developer.intuit.com/app/developer/qbo/docs/api/accounting/all-entities/item */
describe("QuickBooks twin: items", () => {
  it("seeds the company's services and parts as Items", async () => {
    const { twin, qboGet } = setup();
    const catalog = twin.world.catalog;
    for (const [index, entry] of catalog.entries()) {
      const { Item } = await (await qboGet(`/item/${index + 1}`)).json();
      expect(Item).toMatchObject({
        Id: String(index + 1),
        SyncToken: "0",
        Name: entry.name,
        FullyQualifiedName: entry.name,
        Description: entry.description,
        UnitPrice: entry.unitPrice,
        Active: true,
        domain: "QBO",
        sparse: false,
      });
    }
  });

  it("types services as Service and parts as NonInventory, with parts taxable", async () => {
    const { twin, qboGet } = setup();
    const partIndex = twin.world.catalog.findIndex((entry) => entry.kind === "part");
    const { Item: service } = await (await qboGet("/item/1")).json();
    const { Item: part } = await (await qboGet(`/item/${partIndex + 1}`)).json();
    expect(service).toMatchObject({ Type: "Service", Taxable: false, TrackQtyOnHand: false });
    expect(part).toMatchObject({ Type: "NonInventory", Taxable: true, TrackQtyOnHand: false });
  });

  it("answers an unknown item Id with 610 Object Not Found", async () => {
    const { qboGet } = setup();
    const response = await qboGet("/item/999");
    expect(response.status).toBe(400);
    expect((await response.json()).Fault.Error[0].code).toBe("610");
  });

  it("says clearly that it does not create or change Items yet, instead of pretending", async () => {
    const { qboPost } = setup();
    const response = await qboPost("/item", { Name: "New Thing", Type: "Service" });
    expect(response.status).toBe(400);
    const error = (await response.json()).Fault.Error[0];
    expect(error).toMatchObject({ code: "500", Message: "Unsupported operation" });
    expect(error.Detail).toContain("Item");
  });
});
