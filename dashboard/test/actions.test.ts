import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ACTIONS, actionKey } from "../lib/actions.ts";

describe("the actions the control room offers", () => {
  it("knows each action by its vendor and its name, since Jobber and Housecall Pro both pay invoices", () => {
    const keys = ACTIONS.map(actionKey);
    assert.equal(new Set(keys).size, keys.length);
    assert.ok(keys.includes("jobber/payInvoices"));
    assert.ok(keys.includes("housecallpro/payInvoices"));
  });

  it("offers each of Housecall Pro's actions, in the order work goes: customers call, techs finish, the Pro invoices, customers pay", () => {
    assert.deepEqual(
      ACTIONS.filter(({ vendor }) => vendor === "housecallpro").map(({ action }) => action),
      ["newCustomers", "completeJobs", "invoiceJobs", "payInvoices"],
    );
  });
});
