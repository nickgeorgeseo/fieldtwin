import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { FIELD_SERVICES, VENDOR_LABELS, vendorLabel } from "../lib/vendors.ts";

describe("naming the vendors", () => {
  it("spells each vendor's name as people write it, in the order the twin lists them", () => {
    assert.deepEqual(Object.entries(VENDOR_LABELS), [
      ["quickbooks", "QuickBooks"],
      ["jobber", "Jobber"],
      ["housecallpro", "Housecall Pro"],
    ]);
  });

  it("gives a vendor it doesn't know back as the twin names it", () => {
    assert.equal(vendorLabel("servicetitan"), "servicetitan");
  });

  it("compares the books with Jobber, which has clients, and Housecall Pro, which has customers", () => {
    assert.deepEqual(FIELD_SERVICES, { jobber: { customer: "client" }, housecallpro: { customer: "customer" } });
  });
});
