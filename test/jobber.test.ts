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
