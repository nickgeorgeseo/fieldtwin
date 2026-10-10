import { describe, expect, it } from "vitest";
import type { QboState } from "../src/vendors/quickbooks/types.ts";
import { setup } from "./helpers.ts";

/**
 * Request IDs: https://developer.intuit.com/app/developer/qbo/docs/learn/learn-basic-field-definitions (Request ID)
 * "If our service receives another request with the same request ID, instead of performing the operation again or
 * returning an error, it can recognize and send the same response for the original request."
 */
type Harness = ReturnType<typeof setup>;

const customer = (name: string) => ({
  DisplayName: name,
  PrimaryEmailAddr: { Address: `${name.split(" ")[0]!.toLowerCase()}@example.com` },
});
const created = (harness: Harness) => harness.twin.log.all().filter((event) => event.source === "api");

describe("QuickBooks requestid", () => {
  it("answers a repeated write with the first answer, word for word, instead of writing again", async () => {
    const harness = setup();
    const first = await harness.qboPost("/customer?requestid=create-ada-1", customer("Ada Example"));
    harness.twin.advance(60_000); // the retry comes a minute later
    const again = await harness.qboPost("/customer?requestid=create-ada-1", customer("Ada Example"));

    expect(again.status).toBe(200);
    expect(await again.json()).toEqual(await first.json()); // the same Id, and the same `time`
    expect(created(harness).map((event) => event.type)).toEqual(["CustomerCreated"]);
  });

  it("answers as it did the first time even after the record has changed since", async () => {
    const harness = setup();
    const first = (await (await harness.qboPost("/customer?requestid=r-1", customer("Bo Example"))).json()).Customer;
    await harness.qboPost("/customer", { Id: first.Id, SyncToken: first.SyncToken, sparse: true, DisplayName: "Bo Example Jr" });

    const again = (await (await harness.qboPost("/customer?requestid=r-1", customer("Bo Example"))).json()).Customer;
    expect(again).toMatchObject({ Id: first.Id, SyncToken: "0", DisplayName: "Bo Example" });
  });

  it("applies a repeated payment once", async () => {
    const harness = setup();
    const state = harness.twin.state<QboState>("quickbooks");
    const open = [...state.invoices.values()].find((invoice) => invoice.Balance > 0)!;
    const payment = {
      CustomerRef: { value: open.CustomerRef.value },
      TotalAmt: open.Balance,
      Line: [{ Amount: open.Balance, LinkedTxn: [{ TxnId: open.Id, TxnType: "Invoice" }] }],
    };
    const first = await harness.qboPost("/payment?requestid=pay-1", payment);
    const again = await harness.qboPost("/payment?requestid=pay-1", payment);

    expect(again.status).toBe(200);
    expect((await again.json()).Payment.Id).toBe((await first.json()).Payment.Id);
    expect(state.invoices.get(open.Id)!.Balance).toBe(0);
    expect(created(harness).map((event) => event.type)).toEqual(["PaymentCreated", "InvoiceUpdated"]);
  });

  it("writes again for a new requestid, or for none", async () => {
    const harness = setup();
    await harness.qboPost("/customer?requestid=a", customer("Cy Example"));
    await harness.qboPost("/customer?requestid=b", customer("Di Example"));
    await harness.qboPost("/customer", customer("Ed Example"));
    await harness.qboPost("/customer", customer("Flo Example"));
    expect(created(harness)).toHaveLength(4);
  });

  it("remembers only writes that succeeded, so a failed write can be fixed and sent again with the same requestid", async () => {
    const harness = setup();
    const taken = [...harness.twin.state<QboState>("quickbooks").customers.values()][0]!.DisplayName;
    const refused = await harness.qboPost("/customer?requestid=fix-me", customer(taken));
    expect((await refused.json()).Fault.Error[0].code).toBe("6240");

    const fixed = await harness.qboPost("/customer?requestid=fix-me", customer("Gus Example"));
    expect((await fixed.json()).Customer.DisplayName).toBe("Gus Example");
  });

  it("forgets the requestids of writes a rewind undid", async () => {
    const harness = setup();
    harness.twin.checkpoint("before");
    const first = (await (await harness.qboPost("/customer?requestid=undo-me", customer("Hal Example"))).json()).Customer;
    harness.twin.rewind("before");

    const again = (await (await harness.qboPost("/customer?requestid=undo-me", customer("Hal Example"))).json()).Customer;
    expect(again.Id).toBe(first.Id); // created afresh, into the same empty slot
    expect(created(harness)).toHaveLength(1);
  });

  it("rejects a requestid longer than the documented 50 characters", async () => {
    const harness = setup();
    const response = await harness.qboPost(`/customer?requestid=${"x".repeat(51)}`, customer("Ivy Example"));
    expect(response.status).toBe(400);
    expect((await response.json()).Fault.Error[0]).toMatchObject({ code: "2050", element: "requestid" });
    expect(created(harness)).toEqual([]);
  });
});
