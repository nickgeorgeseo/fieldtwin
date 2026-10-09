import { describe, expect, it } from "vitest";
import { setup } from "./helpers.ts";

/** Quote: https://developer.getjobber.com/docs (Important Objects: Quote) */

type Harness = ReturnType<typeof setup>;
const data = async (harness: Harness, query: string, variables?: Record<string, unknown>) => {
  const body = await (await harness.jobber(query, variables)).json();
  if (body.errors) throw new Error(JSON.stringify(body.errors));
  return body.data;
};
const totalOf = (lines: { quantity: number; unitPrice: number }[]) =>
  Math.round(lines.reduce((sum, line) => sum + line.quantity * line.unitPrice, 0) * 100) / 100;

describe("Jobber twin: quotes", () => {
  it("lists quotes in number order with their status, client, and amounts", async () => {
    const harness = setup();
    const { quotes } = await data(
      harness,
      "{ quotes(first: 50) { totalCount nodes { quoteNumber quoteStatus title amounts { subtotal total } client { name } } } }",
    );
    const history = harness.twin.world.history.quotes;
    expect(quotes.totalCount).toBe(history.length);
    expect(quotes.nodes.map((quote: { quoteNumber: string }) => quote.quoteNumber)).toEqual(history.map((quote) => String(quote.number)));

    const [first] = quotes.nodes;
    expect(first.amounts).toEqual({ subtotal: totalOf(history[0]!.lineItems), total: totalOf(history[0]!.lineItems) });
  });

  it("marks quotes that became jobs converted, and unanswered ones awaiting_response", async () => {
    const harness = setup();
    const { quotes } = await data(
      harness,
      "{ quotes(first: 50) { nodes { quoteStatus sentAt transitionedAt jobs(first: 2) { nodes { jobNumber quote { quoteNumber } } } } } }",
    );
    const statuses = new Set(quotes.nodes.map((quote: { quoteStatus: string }) => quote.quoteStatus));
    expect(statuses).toEqual(new Set(["converted", "awaiting_response"]));

    for (const quote of quotes.nodes) {
      if (quote.quoteStatus === "converted") {
        expect(quote.jobs.nodes).toHaveLength(1);
        expect(quote.jobs.nodes[0].quote).toBeTruthy();
      } else {
        expect(quote.jobs.nodes).toEqual([]);
        expect(quote.transitionedAt).toBe(quote.sentAt);
      }
    }
  });

  it("finds a quote by id, with its line items, and lists a client's quotes", async () => {
    const harness = setup();
    const { quotes } = await data(harness, "{ quotes(first: 1) { nodes { id client { id } } } }");
    const { quote } = await data(
      harness,
      "query ($id: EncodedId!) { quote(id: $id) { quoteNumber lineItems(first: 5) { nodes { name quantity unitPrice totalPrice } } } }",
      { id: quotes.nodes[0].id },
    );
    expect(quote.quoteNumber).toBe("1");
    expect(quote.lineItems.nodes.length).toBeGreaterThan(0);

    const { client } = await data(harness, "query ($id: EncodedId!) { client(id: $id) { quotes(first: 10) { nodes { quoteNumber } } } }", {
      id: quotes.nodes[0].client.id,
    });
    expect(client.quotes.nodes.map((q: { quoteNumber: string }) => q.quoteNumber)).toContain("1");
  });
});

describe("Jobber query cost against the real schema", () => {
  it("charges one point per field for a single quote, as in the docs' quote example", async () => {
    const harness = setup();
    const { quotes } = await data(harness, "{ quotes(first: 1) { nodes { id } } }");
    const body = await (
      await harness.jobber("query ($id: EncodedId!) { quote(id: $id) { id title client { id firstName } } }", { id: quotes.nodes[0].id })
    ).json();
    expect(body.extensions.cost.requestedQueryCost).toBe(6);
  });

  it("charges first x fields for a connection, as in the docs' quotes(first: 10) example", async () => {
    const body = await (await setup().jobber("{ quotes(first: 10) { edges { node { id quoteNumber quoteStatus title } } } }")).json();
    expect(body.extensions.cost.requestedQueryCost).toBe(40);
    expect(body.extensions.cost.actualQueryCost).toBe(40);
  });
});
