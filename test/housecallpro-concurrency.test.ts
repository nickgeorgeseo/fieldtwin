import { describe, expect, it } from "vitest";
import { setup } from "./helpers.ts";

type Harness = ReturnType<typeof setup>;

/**
 * A request whose body is still on its way: it starts now, and its body arrives when `send` is called. Whatever happens
 * in between (another write, a reset) happens while the twin waits for the body, as it can on a real network. The
 * request says how long its body is, as clients do, so the twin doesn't wait for all of it before starting.
 */
function slowRequest(harness: Harness, method: string, path: string, body: unknown) {
  const bytes = new TextEncoder().encode(JSON.stringify(body));
  let send!: () => void;
  const arrived = new Promise<void>((resolve) => {
    send = resolve;
  });
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      await arrived;
      controller.enqueue(bytes);
      controller.close();
    },
  });
  const response = harness.app.request(`/housecallpro${path}`, {
    method,
    headers: { Authorization: "Token k", "Content-Type": "application/json", "Content-Length": String(bytes.length) },
    body: stream,
    duplex: "half",
  } as RequestInit);
  return { send, response };
}

const nextTurn = () => new Promise((resolve) => setTimeout(resolve, 5)); // lets the request reach its handler

async function newCustomer(harness: Harness) {
  return (await (await harness.hcpPost("/customers", { first_name: "Wren", last_name: "Hook", email: "wren@example.com" })).json()) as {
    id: string;
  };
}

describe("Housecall Pro twin: writes whose body arrives late", () => {
  it("answer 404 for an address on a customer a reset removed while the body was on its way, and keep the log replayable", async () => {
    const harness = setup();
    const customer = await newCustomer(harness);
    const address = { street: "1 Oak St", city: "Riverton", state: "NC", zip: "28201", country: "US" };
    const slow = slowRequest(harness, "POST", `/customers/${customer.id}/addresses`, address);
    await nextTurn();
    harness.twin.reset();
    slow.send();
    expect((await slow.response).status).toBe(404);
    expect(harness.twin.log.all().some((event) => event.type === "AddressCreated")).toBe(false);

    // The log still replays: a checkpoint after more writes can be rewound to.
    await newCustomer(harness);
    harness.twin.checkpoint("later");
    await newCustomer(harness);
    expect(() => harness.twin.rewind("later")).not.toThrow();
  });

  it("answer 404 for an update to a customer a reset removed while the body was on its way, rather than bring them back", async () => {
    const harness = setup();
    const customer = await newCustomer(harness);
    const slow = slowRequest(harness, "PUT", `/customers/${customer.id}`, { last_name: "Late" });
    await nextTurn();
    harness.twin.reset();
    slow.send();
    expect((await slow.response).status).toBe(404);
    expect((await harness.hcpGet(`/customers/${customer.id}`)).status).toBe(404);
  });

  it("keep a change another request made while an update's body was on its way", async () => {
    const harness = setup();
    const customer = await newCustomer(harness);
    const slow = slowRequest(harness, "PUT", `/customers/${customer.id}`, { last_name: "Slow" });
    await nextTurn();
    expect((await harness.hcpPut(`/customers/${customer.id}`, { email: "faster@example.com" })).status).toBe(200);
    const address = await harness.hcpPost(`/customers/${customer.id}/addresses`, {
      street: "2 Elm",
      city: "R",
      state: "NC",
      zip: "1",
      country: "US",
    });
    slow.send();

    const updated = await (await slow.response).json();
    expect(updated).toMatchObject({ last_name: "Slow", email: "faster@example.com" });
    expect(updated.addresses.map((a: { id: string }) => a.id)).toContain((await address.json()).id);
    expect(await (await harness.hcpGet(`/customers/${customer.id}`)).json()).toEqual(updated);
  });
});
