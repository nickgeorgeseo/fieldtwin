import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { SeededRandom } from "../src/core/random.ts";
import { generateWorld } from "../src/world/generate-world.ts";

const world = (seed: number) => generateWorld(new SeededRandom(seed));
const fingerprint = (seed: number) => {
  const { company, customers, technicians } = world(seed);
  return createHash("sha256").update(JSON.stringify({ company, customers, technicians })).digest("hex").slice(0, 16);
};

describe("the world generator", () => {
  it("keeps the customers and technicians existing seeds already produce", () => {
    // New world features must draw their randomness after everything that came before them, so a
    // bug report that says "seed 42" still means the same company, customers, and technicians.
    expect(fingerprint(42)).toBe("f0943f9aa547f933"); // Rowntree Electric
    expect(fingerprint(7)).toBe("92c311d048c6cca4"); // Thorne Heating & Air
  });

  it("gives the business a price list for its own trade", () => {
    const electrician = world(42);
    expect(electrician.company.trade).toBe("electrical");
    const names = electrician.catalog.map((entry) => entry.name);
    expect(names).toContain("Panel inspection");
    expect(names).not.toContain("AC tune-up");

    const hvac = world(7);
    expect(hvac.catalog.map((entry) => entry.name)).toContain("AC tune-up");
  });

  it("mixes services and parts, with plausible prices in whole dollars", () => {
    const { catalog } = world(42);
    expect(catalog.some((entry) => entry.kind === "service")).toBe(true);
    expect(catalog.some((entry) => entry.kind === "part")).toBe(true);
    for (const entry of catalog) {
      expect(entry.unitPrice).toBeGreaterThan(0);
      expect(Number.isInteger(entry.unitPrice)).toBe(true);
    }
  });

  it("uses names every vendor accepts: unique, and free of colons, tabs, and newlines", () => {
    // QuickBooks Item names "must be unique ... and cannot include tabs, new lines, or colons".
    for (const seed of [1, 7, 42, 99]) {
      const names = world(seed).catalog.map((entry) => entry.name);
      expect(new Set(names).size).toBe(names.length);
      for (const name of names) expect(name).not.toMatch(/[:\t\n]/);
    }
  });

  it("prices the same seed the same way every time, and different seeds differently", () => {
    expect(world(42).catalog).toEqual(world(42).catalog);
    const prices = (seed: number) => world(seed).catalog.map((entry) => entry.unitPrice);
    const electricalSeeds = [42, 1, 2, 3, 4, 5, 6, 8].filter((seed) => world(seed).company.trade === "electrical");
    expect(new Set(electricalSeeds.map((seed) => prices(seed).join(","))).size).toBeGreaterThan(1);
  });
});
