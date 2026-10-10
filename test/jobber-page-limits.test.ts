import { describe, expect, it } from "vitest";
import { loadScenarioByName } from "../src/control/operations.ts";
import { setup } from "./helpers.ts";

/**
 * Page sizes at the edges. Jobber: "All connection fields are configured to return a maximum of 100 nodes"
 * (https://developer.getjobber.com/docs/using_jobbers_api/api_rate_limits). Jobber runs graphql-ruby, whose
 * connections treat a negative `first` or `last` as 0 and cap one above the maximum at the maximum.
 */

const ids = (body: { data: { clients: { nodes: { id: string }[] } } }) => body.data.clients.nodes.map((node) => node.id);

describe("Jobber connections: page sizes at the edges", () => {
  it("returns at most 100 nodes, however many are asked for, and says there are more", async () => {
    const harness = setup();
    loadScenarioByName(harness.twin, "heat-wave-monday"); // 120 customers
    for (const size of ["first: 500", "last: 1000"]) {
      const body = await (
        await harness.jobber(`{ clients(${size}) { nodes { id } totalCount pageInfo { hasNextPage hasPreviousPage } } }`)
      ).json();
      expect(body.data.clients.nodes).toHaveLength(100);
      expect(body.data.clients.totalCount).toBe(120);
      const { hasNextPage, hasPreviousPage } = body.data.clients.pageInfo;
      expect(size.startsWith("first") ? hasNextPage : hasPreviousPage).toBe(true);
    }
  });

  it("treats a negative first or last as 0: no nodes, nothing charged per node, and Relay's pageInfo for an empty page", async () => {
    const harness = setup();
    const body = await (await harness.jobber("{ clients(first: -5) { nodes { id name } pageInfo { hasNextPage endCursor } } }")).json();
    expect(body.data.clients.nodes).toEqual([]);
    expect(body.extensions.cost.requestedQueryCost).toBeGreaterThanOrEqual(0);
    expect(body.data.clients.pageInfo).toEqual({ hasNextPage: true, endCursor: null });
  });

  it("can't be used to sneak an expensive query past the throttle with a negative page size", async () => {
    const tooExpensive = "a: clients(first: 100) { nodes { id jobs(first: 100) { nodes { id title } } } }"; // 20,100 points
    const body = await (await setup().jobber(`{ ${tooExpensive} b: clients(first: -1000000) { nodes { id } } }`)).json();
    expect(body.errors?.[0]?.extensions?.code).toBe("THROTTLED");
    expect(body.extensions.cost.requestedQueryCost).toBe(20_100);
  });

  it("pages through all 120 clients 100 at a time", async () => {
    const harness = setup();
    loadScenarioByName(harness.twin, "heat-wave-monday");
    const seen: string[] = [];
    let after: string | null = null;
    for (let page = 0; page < 5; page++) {
      const response = await harness.jobber(
        "query ($after: String) { clients(first: 500, after: $after) { nodes { id } pageInfo { hasNextPage endCursor } } }",
        { after },
      );
      const body = await response.json();
      seen.push(...ids(body));
      if (!body.data.clients.pageInfo.hasNextPage) break;
      after = body.data.clients.pageInfo.endCursor;
    }
    expect(seen).toHaveLength(120);
    expect(new Set(seen).size).toBe(120);
  });
});

describe("Jobber query cost: variables and directives", () => {
  it("prices a page size from a variable's default when the variable isn't sent", async () => {
    const harness = setup();
    const query = "query Clients($n: Int = 10) { clients(first: $n) { nodes { id jobs(first: $n) { nodes { id title } } } } }";
    const withDefault = await (await harness.jobber(query)).json();
    const sent = await (await harness.jobber(query, { n: 10 })).json();
    expect(withDefault.errors).toBeUndefined();
    expect(withDefault.extensions.cost.requestedQueryCost).toBe(sent.extensions.cost.requestedQueryCost);
  });

  it("doesn't charge for fields that @skip or @include leave out", async () => {
    const harness = setup();
    const query = `query ($withJobs: Boolean!) { clients(first: 10) { nodes { id jobs @include(if: $withJobs) { nodes { id title } } } } }`;
    const without = await (await harness.jobber(query, { withJobs: false })).json();
    expect(without.errors).toBeUndefined();
    expect(without.extensions.cost.requestedQueryCost).toBe(10);
    const skipped = await (await harness.jobber("{ clients(first: 10) { nodes { id name @skip(if: true) } } }")).json();
    expect(skipped.extensions.cost.requestedQueryCost).toBe(10);
  });
});
