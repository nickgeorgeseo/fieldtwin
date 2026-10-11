import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { summaryParts } from "../lib/summaries.ts";

describe("reading the twin's one-line summaries of what happened", () => {
  it("separates the time, vendor, what happened, and who did it", () => {
    assert.deepEqual(summaryParts('2026-07-13T11:00:00.000Z  quickbooks  CustomerCreated Id=26 "Dana Whitfield" SyncToken=0  (api)'), {
      at: "2026-07-13T11:00:00.000Z",
      vendor: "quickbooks",
      what: 'CustomerCreated Id=26 "Dana Whitfield" SyncToken=0',
      source: "api",
    });
  });

  it("keeps what happened whole when it has parentheses of its own", () => {
    const parts = summaryParts('2026-07-13T17:00:00.000Z  jobber  InvoiceUpdated #13 "Refrigerant recharge" (paid)  (scenario)');
    assert.equal(parts.what, 'InvoiceUpdated #13 "Refrigerant recharge" (paid)');
    assert.equal(parts.source, "scenario");
  });

  it("shows a summary it can't read as it is", () => {
    assert.deepEqual(summaryParts("something new"), { at: null, vendor: null, what: "something new", source: null });
  });
});
