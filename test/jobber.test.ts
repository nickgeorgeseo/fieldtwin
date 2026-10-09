import { describe, expect, it } from "vitest";
import { setup } from "./helpers.ts";

const CLIENTS_PAGE = `query ($first: Int, $after: String) {
  clients(first: $first, after: $after) { nodes { id name } pageInfo { hasNextPage endCursor } totalCount }
}`;

describe("Jobber twin", () => {
  it("pages through clients with Relay-style cursors", async () => {
    const { jobber } = setup();
    const page1 = (await (await jobber(CLIENTS_PAGE, { first: 20 })).json()).data.clients;
    expect(page1.nodes).toHaveLength(20);
    expect(page1.pageInfo.hasNextPage).toBe(true);

    const page2 = (await (await jobber(CLIENTS_PAGE, { first: 20, after: page1.pageInfo.endCursor })).json()).data.clients;
    expect(page2.nodes).toHaveLength(5);
    expect(page2.pageInfo.hasNextPage).toBe(false);
  });
});

describe("Jobber twin: connections", () => {
  it("serves edges with cursors as well as nodes, like the docs' quotes(first: 10) { edges { node } } example", async () => {
    const { jobber } = setup();
    const body = await (await jobber("{ clients(first: 3) { edges { cursor node { id name } } nodes { id } } }")).json();
    const { edges, nodes } = body.data.clients;
    expect(edges).toHaveLength(3);
    expect(edges.map((edge: { node: { id: string } }) => edge.node.id)).toEqual(nodes.map((node: { id: string }) => node.id));
    expect(new Set(edges.map((edge: { cursor: string }) => edge.cursor)).size).toBe(3);
  });

  it("resumes after any edge's cursor, and reports both ends of the page", async () => {
    const { jobber } = setup();
    const first = (await (await jobber("{ clients(first: 5) { edges { cursor node { id } } } }")).json()).data.clients.edges;
    const query = `query ($after: String) { clients(first: 2, after: $after) {
      nodes { id } pageInfo { hasNextPage hasPreviousPage startCursor endCursor } } }`;
    const body = await (await jobber(query, { after: first[2].cursor })).json();
    expect(body.data.clients.nodes.map((node: { id: string }) => node.id)).toEqual([first[3].node.id, first[4].node.id]);
    expect(body.data.clients.pageInfo).toMatchObject({
      hasNextPage: true,
      hasPreviousPage: true,
      startCursor: first[3].cursor,
      endCursor: first[4].cursor,
    });
  });

  it("rejects a cursor it never issued", async () => {
    const { jobber } = setup();
    const body = await (await jobber(`{ clients(first: 2, after: "not-a-cursor") { nodes { id } } }`)).json();
    expect(body.errors[0].message).toContain("cursor");
  });
});

describe("Jobber twin: clients", () => {
  it("answers the documented client fields", async () => {
    const { twin, jobber } = setup();
    const person = twin.world.customers[0]!;
    const body = await (
      await jobber("{ clients(first: 1) { nodes { firstName lastName name isCompany email phone emails { address primary } } } }")
    ).json();
    expect(body.data.clients.nodes[0]).toEqual({
      firstName: person.firstName,
      lastName: person.lastName,
      name: `${person.firstName} ${person.lastName}`,
      isCompany: false,
      email: person.email,
      phone: person.phone,
      emails: [{ address: person.email, primary: true }],
    });
  });
});
