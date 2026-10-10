import { getNamedType, isObjectType } from "graphql";
import { describe, expect, it } from "vitest";
import { schema } from "../src/vendors/jobber/graphql.ts";
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

  it("treats after: null as the first page, the way Relay clients ask for it", async () => {
    const { jobber } = setup();
    const body = await (await jobber(CLIENTS_PAGE, { first: 3, after: null })).json();
    expect(body.errors).toBeUndefined();
    expect(body.data.clients.nodes).toHaveLength(3);
    expect(body.data.clients.pageInfo.hasNextPage).toBe(true);
  });

  it("rejects a cursor it never issued", async () => {
    const { jobber } = setup();
    for (const args of [`first: 2, after: "not-a-cursor"`, `last: 2, before: "not-a-cursor"`]) {
      const body = await (await jobber(`{ clients(${args}) { nodes { id } } }`)).json();
      expect(body.errors[0].message).toContain("cursor");
    }
  });
});

/**
 * Paging backwards. Jobber's docs say its pagination is "based on the Relay framework" and name `first` and `last`
 * (https://developer.getjobber.com/docs/using_jobbers_api/api_rate_limits); the Relay connection spec gives the
 * rest, `before` and how each argument moves the page: https://relay.dev/graphql/connections.htm
 */
describe("Jobber twin: paging backwards", () => {
  type Edge = { cursor: string; node: { id: string } };
  const PAGE = `query ($first: Int, $after: String, $last: Int, $before: String) {
    clients(first: $first, after: $after, last: $last, before: $before) {
      nodes { id } pageInfo { hasNextPage hasPreviousPage startCursor endCursor } } }`;
  const ids = (items: { id: string }[]) => items.map((item) => item.id);

  async function firstFive() {
    const harness = setup();
    const body = await (await harness.jobber("{ clients(first: 5) { edges { cursor node { id } } } }")).json();
    const page = async (variables: Record<string, unknown>) => (await (await harness.jobber(PAGE, variables)).json()).data.clients;
    return { ...harness, edges: body.data.clients.edges as Edge[], page };
  }

  it("serves the clients just before a cursor with last and before", async () => {
    const { edges, page } = await firstFive();
    const clients = await page({ last: 2, before: edges[3]!.cursor });
    expect(ids(clients.nodes)).toEqual([edges[1]!.node.id, edges[2]!.node.id]);
    expect(clients.pageInfo).toEqual({
      hasNextPage: true,
      hasPreviousPage: true,
      startCursor: edges[1]!.cursor,
      endCursor: edges[2]!.cursor,
    });
  });

  it("says nothing comes earlier once paging backwards reaches the start", async () => {
    const { edges, page } = await firstFive();
    const clients = await page({ last: 5, before: edges[3]!.cursor });
    expect(ids(clients.nodes)).toEqual(edges.slice(0, 3).map((edge) => edge.node.id));
    expect(clients.pageInfo).toMatchObject({ hasNextPage: true, hasPreviousPage: false });
  });

  it("serves the end of the list with last alone", async () => {
    const { jobber, page } = await firstFive();
    const all = (await (await jobber("{ clients(first: 100) { nodes { id } } }")).json()).data.clients.nodes;
    const clients = await page({ last: 3 });
    expect(ids(clients.nodes)).toEqual(ids(all.slice(-3)));
    expect(clients.pageInfo).toMatchObject({ hasNextPage: false, hasPreviousPage: true });
  });

  it("serves what lies between two cursors with after and before", async () => {
    const { edges, page } = await firstFive();
    const clients = await page({ first: 10, after: edges[0]!.cursor, before: edges[4]!.cursor });
    expect(ids(clients.nodes)).toEqual(edges.slice(1, 4).map((edge) => edge.node.id));
    // As the spec's algorithm gives it: `first` wasn't what ended the page, and `after` means there are earlier clients.
    expect(clients.pageInfo).toMatchObject({ hasNextPage: false, hasPreviousPage: true });
  });

  it("offers first, after, last, and before on every connection, nested ones included", () => {
    const connections = Object.values(schema.getTypeMap())
      .filter(isObjectType)
      .flatMap((type) => Object.values(type.getFields()).map((field) => ({ name: `${type.name}.${field.name}`, field })))
      .filter(({ field }) => getNamedType(field.type).name.endsWith("Connection"));
    expect(connections.length).toBeGreaterThan(10);
    for (const { name, field } of connections) {
      expect([name, field.args.map((arg) => arg.name).sort()]).toEqual([name, ["after", "before", "first", "last"]]);
    }
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
