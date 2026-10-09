import { describe, expect, it } from "vitest";
import { createCheckpoint, listChanges } from "../src/control/operations.ts";
import { setup } from "./helpers.ts";

/** Mutations: https://developer.getjobber.com/docs/using_jobbers_api/api_queries_and_mutations/ */

// The sample mutation from Jobber's docs, with an example.com address.
const SAMPLE_MUTATION = `mutation SampleMutation {
  clientCreate(
    input: {
      firstName: "Jane"
      lastName: "Doe"
      companyName: "Jane's Automotive"
      emails: [
        { description: MAIN, primary: true, address: "jane@example.com" }
      ]
    }
  ) {
    client {
      id
      firstName
      lastName
    }
    userErrors {
      message
      path
    }
  }
}`;

const CREATE = `mutation ($input: ClientCreateInput!) {
  clientCreate(input: $input) { client { id name isCompany email } userErrors { message path } }
}`;

describe("Jobber twin: clientCreate", () => {
  it("creates a client from the docs' sample mutation, with no userErrors", async () => {
    const harness = setup();
    const body = await (await harness.jobber(SAMPLE_MUTATION)).json();
    expect(body.errors).toBeUndefined();
    const { client, userErrors } = body.data.clientCreate;
    expect(userErrors).toEqual([]);
    expect(client).toMatchObject({ firstName: "Jane", lastName: "Doe" });

    const read = await (
      await harness.jobber("query ($id: EncodedId!) { client(id: $id) { name emails { address primary } } }", { id: client.id })
    ).json();
    expect(read.data.client).toEqual({ name: "Jane's Automotive", emails: [{ address: "jane@example.com", primary: true }] });
  });

  it("answers a missing last name with the documented userError, and creates nothing", async () => {
    const harness = setup();
    const before = harness.twin.log.length;
    const body = await (await harness.jobber(CREATE, { input: { firstName: "Solo" } })).json();
    expect(body.errors).toBeUndefined(); // the request was valid; the business rule rejected it
    expect(body.data.clientCreate).toEqual({
      client: null,
      userErrors: [{ message: "Last name is required", path: ["input", "lastName"] }],
    });
    expect(harness.twin.log.length).toBe(before);
  });

  it("names a client after its company when it has one", async () => {
    const harness = setup();
    const body = await (await harness.jobber(CREATE, { input: { firstName: "Pat", lastName: "Lee", companyName: "Lee Rentals" } })).json();
    expect(body.data.clientCreate.client).toMatchObject({ name: "Lee Rentals", isCompany: true, email: null });
  });

  it("records the new client as a change made through the API", async () => {
    const harness = setup();
    createCheckpoint(harness.twin, "before");
    await harness.jobber(CREATE, { input: { firstName: "Ana", lastName: "Ruiz" } });
    const changes = listChanges(harness.twin, "before", { onlyFromApi: true });
    expect(changes.map((change) => change.summary.split("  ").slice(1).join("  "))).toEqual(['jobber  ClientCreated "Ana Ruiz"  (api)']);

    const page = await (await harness.jobber("{ clients(first: 1) { totalCount } }")).json();
    expect(page.data.clients.totalCount).toBe(harness.twin.world.customers.length + 1);
  });

  it("rejects a wrongly typed argument as a top-level error, with HTTP 200", async () => {
    const harness = setup();
    const response = await harness.jobber("mutation { clientCreate(input: { lastName: 5 }) { userErrors { message } } }");
    expect(response.status).toBe(200);
    expect((await response.json()).errors[0].message).toBeTruthy();
  });

  it("charges mutations by the same field rules as queries", async () => {
    const body = await (await setup().jobber(SAMPLE_MUTATION)).json();
    // clientCreate 1 + client 1 + 3 fields + userErrors 1 + 2 fields
    expect(body.extensions.cost.requestedQueryCost).toBe(8);
  });
});
