import { buildSchema, parse } from "graphql";
import { describe, expect, it } from "vitest";
import { actualQueryCost, requestedQueryCost } from "../src/vendors/jobber/cost.ts";
import { setup } from "./helpers.ts";

/**
 * The worked examples from https://developer.getjobber.com/docs/using_jobbers_api/api_rate_limits
 * ("Cost Calculation" and "Connection Fields"), run against a minimal schema with the fields they use.
 */
const docsSchema = buildSchema(`
  scalar EncodedId
  type Query { quote(id: EncodedId!): Quote, quotes(first: Int, last: Int, after: String): QuoteConnection! }
  type Quote { id: EncodedId!, cost: Float, title: String, quoteNumber: String!, quoteStatus: String!, client: Client }
  type Client { id: EncodedId!, firstName: String! }
  type QuoteConnection { edges: [QuoteEdge!]!, nodes: [Quote!]!, pageInfo: PageInfo!, totalCount: Int! }
  type QuoteEdge { node: Quote!, cursor: String! }
  type PageInfo { hasNextPage: Boolean!, endCursor: String }
`);
const cost = (query: string, variables: Record<string, unknown> = {}) => requestedQueryCost(docsSchema, parse(query), variables);

describe("Jobber query cost: the documented worked examples", () => {
  it("charges one point per field: the docs' quote query costs 7", () => {
    expect(cost(`query { quote(id: "MTc1") { id cost title client { id firstName } } }`)).toBe(7);
  });

  it("multiplies a connection's fields by `first`: 10 nodes of 5 fields cost 50", () => {
    expect(cost(`query { quotes(first: 10) { edges { node { id cost quoteNumber quoteStatus title } } } }`)).toBe(50);
  });

  it("assumes 100 nodes when a connection has no `first` or `last`: the same query costs 500", () => {
    expect(cost(`query { quotes { edges { node { id cost quoteNumber quoteStatus title } } } }`)).toBe(500);
  });
});

describe("Jobber query cost: the rest of the rules", () => {
  it("treats `last` like `first`, and reads page sizes from variables", () => {
    expect(cost(`query { quotes(last: 4) { nodes { id title } } }`)).toBe(8);
    expect(cost(`query ($n: Int) { quotes(first: $n) { nodes { id title } } }`, { n: 3 })).toBe(6);
  });

  it("charges connection-level fields like pageInfo and totalCount once, not per node", () => {
    expect(cost(`query { quotes(first: 10) { nodes { id } pageInfo { hasNextPage endCursor } totalCount } }`)).toBe(10 + 3 + 1);
  });

  it("counts fields inside fragments", () => {
    expect(cost(`query { quote(id: "MTc1") { ...Basics client { ... on Client { id } } } } fragment Basics on Quote { id title }`)).toBe(
      1 + 2 + 1 + 1,
    );
  });

  it("charges what actually came back: fewer nodes than `first` cost less", () => {
    const document = parse(`query { quotes(first: 50) { nodes { id title } } }`);
    const data = {
      quotes: {
        nodes: [
          { id: "a", title: "x" },
          { id: "b", title: "y" },
        ],
      },
    };
    expect(requestedQueryCost(docsSchema, document, {})).toBe(100);
    expect(actualQueryCost(docsSchema, document, {}, data)).toBe(4);
  });

  it("charges a field that resolved to null, but nothing beneath it", () => {
    const document = parse(`query { quote(id: "MTc1") { id cost title client { id firstName } } }`);
    expect(actualQueryCost(docsSchema, document, {}, { quote: null })).toBe(1);
  });
});

describe("Jobber twin: the cost bucket", () => {
  it("reports both costs and deducts the actual cost, as in the docs' response example", async () => {
    const { jobber } = setup();
    const body = await (await jobber(`{ clients(first: 50) { nodes { id firstName } } }`)).json();
    // 25 seeded clients: requested assumes 50 nodes, actual counts the 25 that came back.
    expect(body.extensions.cost).toEqual({
      requestedQueryCost: 100,
      actualQueryCost: 50,
      throttleStatus: { maximumAvailable: 10000, currentlyAvailable: 9950, restoreRate: 500 },
    });
  });

  it("throttles when the requested cost exceeds what is available, then refills with twin time", async () => {
    const { twin, jobber } = setup();
    const expensive = `{ clients(first: 1000) { nodes { emails { address } phones { number } } } }`;

    let body = await (await jobber(expensive)).json();
    expect(body.extensions.cost.requestedQueryCost).toBe(4000);
    while (!body.errors) body = await (await jobber(expensive)).json();
    expect(body.errors[0].extensions.code).toBe("THROTTLED");
    expect(body.extensions.cost.actualQueryCost).toBe(0);

    twin.clock.advance(20_000); // 20 seconds at 500 points/second refills the bucket
    body = await (await jobber(expensive)).json();
    expect(body.errors).toBeUndefined();
  });

  it("never runs a query that costs more than the whole bucket", async () => {
    const { twin, jobber } = setup();
    const huge = `{ clients(first: 5000) { nodes { id firstName lastName } } }`;
    twin.clock.advance(3_600_000);
    const body = await (await jobber(huge)).json();
    expect(body.extensions.cost.requestedQueryCost).toBe(15000);
    expect(body.errors[0].extensions.code).toBe("THROTTLED");
  });
});
