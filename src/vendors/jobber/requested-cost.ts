import type { FieldNode, GraphQLNamedType } from "graphql";
import { MAX_PAGE_SIZE } from "./resolvers/connection.ts";
import { byResponseKey, type Context, fieldsOf, fieldType, isConnection, readInt } from "./selections.ts";

/**
 * The requested cost: what a query could cost, before it runs, by the rules cost.ts quotes from Jobber's docs.
 * https://developer.getjobber.com/docs/using_jobbers_api/api_rate_limits
 */

export const PER_NODE_FIELDS = new Set(["nodes", "edges"]);

/**
 * Nested page sizes multiply, and a few dozen levels of `first: 2147483647` overflow a double to Infinity, which
 * JSON writes as null and which a page size of 0 below it turns into NaN, a cost no throttle check refuses. Costs
 * stop at the largest whole number a double holds exactly: any query that reaches it costs more than the bucket.
 */
const MAX_COST = Number.MAX_SAFE_INTEGER;

/**
 * How many selections pricing reads before it gives up. Fields that share an answer key are merged, and fragments
 * can merge into a different mix of fields down every path, so pricing a query exactly can take as long as its
 * answer is big: exponential in a few KB of query. A real query reads a few thousand selections; past this budget
 * the query gets an error asking for a simpler one, rather than stalling the twin.
 */
export const PRICING_BUDGET = 200_000;

/**
 * A selection to price: fields of one parent type, already read through their fragments. A connection's selection
 * carries its page size, which multiplies what is under `nodes` and `edges`.
 */
interface Selection {
  fields: FieldNode[];
  type: GraphQLNamedType;
  pageSize?: number;
}

/**
 * The cost of a selection, with every multiplier above it taken as 1. Costs scale with the multiplier, so a parent
 * multiplies a child's cost by its page size instead of passing the size down, and a selection reached many times
 * (one fragment spread under several aliases, or by fragments that each spread the next twice) is priced once: its
 * key is its parent type, page size, and the very fields it holds. That keeps pricing about as long as the query,
 * where walking each spread again would double at every level and let a 3 KB query stall the twin for hours.
 *
 * A stack of selections still to price rather than recursion, for the same reason as fieldsOf: a chain of fragments
 * can nest fields thousands deep, and pricing it recursively would run out of stack and answer with a 500.
 * Undefined when the query is too complex to price within PRICING_BUDGET.
 */
export function requestedSelectionCost(rootFields: FieldNode[], rootType: GraphQLNamedType, context: Context): number | undefined {
  const walked = { selections: rootFields.length };
  const ids = new Map<FieldNode, number>();
  const idOf = (field: FieldNode) => {
    if (!ids.has(field)) ids.set(field, ids.size);
    return ids.get(field);
  };
  const keyOf = ({ fields, type, pageSize }: Selection) => `${type.name} ${pageSize ?? ""} ${fields.map(idOf).join(",")}`;
  const priced = new Map<string, number>();
  const root: Selection = { fields: rootFields, type: rootType };
  const rootKey = keyOf(root);
  const stack = [{ selection: root, key: rootKey, groups: byResponseKey(rootFields), next: 0, cost: 0 }];
  while (stack.length) {
    if (walked.selections > PRICING_BUDGET) return undefined;
    const frame = stack[stack.length - 1]!;
    const group = frame.groups[frame.next];
    if (!group) {
      priced.set(frame.key, frame.cost);
      stack.pop();
      continue;
    }
    const charge = fieldCharge(group, frame.selection, context, walked);
    const childKey = charge.child && keyOf(charge.child);
    if (charge.child && childKey && !priced.has(childKey)) {
      stack.push({ selection: charge.child, key: childKey, groups: byResponseKey(charge.child.fields), next: 0, cost: 0 });
      continue;
    }
    const childCost = childKey ? priced.get(childKey)! : 0;
    frame.cost = Math.min(frame.cost + charge.points + Math.min(charge.times * childCost, MAX_COST), MAX_COST);
    frame.next++;
  }
  return priced.get(rootKey);
}

/**
 * What one answer key costs in its parent selection: its own points, plus the selection beneath it, which costs
 * `times` over, the page size under `nodes` and `edges`. Fields sharing a key are merged, as execution merges them.
 */
function fieldCharge(group: FieldNode[], parent: Selection, context: Context, walked: { selections: number }) {
  const field = group[0]!;
  const type = fieldType(parent.type, field);
  if (!type) return { points: 0, times: 0 }; // __typename and other meta fields
  if (!field.selectionSet) return { points: 1, times: 0 }; // a scalar or enum: 1 point
  const child = (pageSize?: number): Selection => ({
    fields: fieldsOf(
      group.flatMap((each) => (each.selectionSet ? [each.selectionSet] : [])),
      context,
      walked,
    ),
    type,
    pageSize,
  });

  // Under a connection, per-node fields are multiplied by the page size. Nothing under a page of 0 can cost
  // anything, so it isn't read at all.
  if (parent.pageSize !== undefined && PER_NODE_FIELDS.has(field.name.value)) {
    return parent.pageSize === 0 ? { points: 0, times: 0 } : { points: 0, child: child(), times: parent.pageSize };
  }
  if (field.name.value === "node") return { points: 0, child: child(), times: 1 }; // edge.node is free
  // The connection field is free; what it holds is priced with its page size. Any other object costs 1 point.
  if (isConnection(type)) return { points: 0, child: child(requestedPageSize(field, context)), times: 1 };
  return { points: 1, child: child(), times: 1 };
}

function requestedPageSize(field: FieldNode, context: Context): number {
  for (const name of ["first", "last"]) {
    const argument = field.arguments?.find((candidate) => candidate.name.value === name);
    const size = argument && readInt(argument.value, context.variables);
    if (size !== undefined) return Math.max(0, size);
  }
  return MAX_PAGE_SIZE;
}
