import { describe, expect, it } from "vitest";
import { salesLineFor } from "../src/sync.ts";

/**
 * What happens in production that a single clean run never shows: line items whose arithmetic QuickBooks would refuse.
 */

describe("a Jobber line whose quantity times price isn't its total", () => {
  it("is booked at its total, without the Qty and UnitPrice QuickBooks would refuse with 6070", () => {
    const line = { name: "Panel inspection", description: null, quantity: 3, unitPrice: 33.33, totalPrice: 100 }; // 3 × 33.33 is 99.99
    expect(salesLineFor(line, "7")).toEqual({
      DetailType: "SalesItemLineDetail",
      Amount: 100,
      Description: "Panel inspection (3 × 33.33)",
      SalesItemLineDetail: { ItemRef: { value: "7" } },
    });
  });

  it("keeps Qty and UnitPrice when they agree with the total, to the cent", () => {
    const line = { name: "Labor", description: "Two and a half hours", quantity: 2.5, unitPrice: 33.33, totalPrice: 83.33 };
    expect(salesLineFor(line, "1").SalesItemLineDetail).toEqual({ ItemRef: { value: "1" }, Qty: 2.5, UnitPrice: 33.33 });
  });
});
