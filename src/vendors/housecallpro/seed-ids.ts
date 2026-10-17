import type { World } from "../../world/generate-world.ts";
import { type HcpIdPrefix, hcpId } from "./ids.ts";

/**
 * Housecall Pro ids for the world's records, numbered in the order seeding creates them, as state.ts counts them, so
 * the first record a client creates gets the next number. The world's keys ("cust-007", "job-0012") map to them.
 */
export class SeedIds {
  private readonly customerNumbers: Map<string, number>;
  private readonly counters = new Map<HcpIdPrefix, number>();

  constructor(private readonly world: World) {
    const inHousecallPro = world.customers.filter((person) => !world.drift.accountingOnly.includes(person.key));
    this.customerNumbers = new Map(inHousecallPro.map((person, index) => [person.key, index + 1]));
  }

  /** The customers Housecall Pro has: everyone but those only the books know (world/drift.ts), in the world's order. */
  customerKeys(): string[] {
    return [...this.customerNumbers.keys()];
  }

  customer(key: string): string {
    return hcpId("cus", this.customerNumbers.get(key)!);
  }

  /** Each customer's one address, numbered as the customer is. */
  address(customerKey: string): string {
    return hcpId("adr", this.customerNumbers.get(customerKey)!);
  }

  employee(technicianKey: string): string {
    return hcpId("pro", this.world.technicians.findIndex((tech) => tech.key === technicianKey) + 1);
  }

  /** A numbered world record ("job-0012", "quote-0003") by its number, which is its order of creation. */
  numbered(prefix: "job" | "est" | "invoice", key: string): string {
    return hcpId(prefix, Number(key.slice(key.lastIndexOf("-") + 1)));
  }

  /** The next id of a kind the world doesn't number, like a line item. */
  next(prefix: HcpIdPrefix): string {
    const n = (this.counters.get(prefix) ?? 0) + 1;
    this.counters.set(prefix, n);
    return hcpId(prefix, n);
  }
}
