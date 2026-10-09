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

  it("reports query cost and throttles when the bucket runs dry, then refills with twin time", async () => {
    const { twin, jobber } = setup();
    const expensive = `{ clients(first: 1000) { nodes { emails { address } phones { number } } } }`;

    let body = await (await jobber(expensive)).json();
    expect(body.extensions.cost.requestedQueryCost).toBeGreaterThan(2000);
    while (!body.errors) body = await (await jobber(expensive)).json();
    expect(body.errors[0].extensions.code).toBe("THROTTLED");

    twin.clock.advance(20_000); // 20 seconds at 500 points/second refills the bucket
    body = await (await jobber(expensive)).json();
    expect(body.errors).toBeUndefined();
  });

  it("requires the version header, like the real API", async () => {
    const { app } = setup();
    const response = await app.request("/api/graphql", {
      method: "POST",
      headers: { Authorization: "Bearer t", "Content-Type": "application/json" },
      body: JSON.stringify({ query: "{ account { name } }" }),
    });
    expect(response.status).toBe(400);
  });
});
