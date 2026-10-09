import { Kind, type DocumentNode, type SelectionSetNode, type ValueNode } from "graphql";

/**
 * Jobber's query-cost rate limit, modeled as a leaky bucket.
 * Reference: https://developer.getjobber.com/docs/using_jobbers_api/api_rate_limits
 *
 * Published numbers: a 10,000 point bucket per app + account, refilling at 500 points per second.
 * The cost FORMULA below is the twin's approximation (see FIDELITY.md): it gets the shape right
 * (big pages and deep nesting cost more, missing `first` assumes 100 nodes), not Jobber's exact numbers.
 */

export const MAXIMUM_AVAILABLE = 10_000;
export const RESTORE_RATE_PER_SECOND = 500;
const ASSUMED_PAGE_SIZE = 100; // Jobber charges for 100 nodes when `first` is not given

export class CostBucket {
  private available = MAXIMUM_AVAILABLE;
  private lastUpdatedMs: number | null = null;

  /** Refill for the twin time that passed, then try to spend `cost` points. */
  trySpend(cost: number, nowMs: number): { allowed: boolean; currentlyAvailable: number } {
    this.refill(nowMs);
    if (cost > this.available) return { allowed: false, currentlyAvailable: this.available };
    this.available -= cost;
    return { allowed: true, currentlyAvailable: this.available };
  }

  private refill(nowMs: number): void {
    // After a reset or rewind the clock can be earlier than our last update. Start full.
    if (this.lastUpdatedMs === null || nowMs < this.lastUpdatedMs) {
      this.available = MAXIMUM_AVAILABLE;
    } else {
      const seconds = (nowMs - this.lastUpdatedMs) / 1000;
      this.available = Math.min(MAXIMUM_AVAILABLE, this.available + seconds * RESTORE_RATE_PER_SECOND);
    }
    this.lastUpdatedMs = nowMs;
  }
}

/** Estimated cost of a query: one point per field, multiplied by the page size of every list above it. */
export function estimateQueryCost(document: DocumentNode, variables: Record<string, unknown> = {}): number {
  let total = 0;
  for (const definition of document.definitions) {
    if (definition.kind === Kind.OPERATION_DEFINITION) total += costOf(definition.selectionSet, 1, variables);
  }
  return Math.ceil(total);
}

function costOf(selectionSet: SelectionSetNode, multiplier: number, variables: Record<string, unknown>): number {
  let cost = 0;
  for (const selection of selectionSet.selections) {
    if (selection.kind !== Kind.FIELD || !selection.selectionSet) continue; // scalars are free

    cost += multiplier;
    const firstArg = selection.arguments?.find((arg) => arg.name.value === "first");
    const isPaginated = firstArg || selection.selectionSet.selections.some(
      (child) => child.kind === Kind.FIELD && (child.name.value === "nodes" || child.name.value === "edges"),
    );
    const pageSize = firstArg ? readInt(firstArg.value, variables) ?? ASSUMED_PAGE_SIZE : ASSUMED_PAGE_SIZE;
    cost += costOf(selection.selectionSet, isPaginated ? multiplier * pageSize : multiplier, variables);
  }
  return cost;
}

function readInt(value: ValueNode, variables: Record<string, unknown>): number | undefined {
  if (value.kind === Kind.INT) return Number(value.value);
  if (value.kind === Kind.VARIABLE) {
    const variable = variables[value.name.value];
    return typeof variable === "number" ? variable : undefined;
  }
  return undefined;
}
