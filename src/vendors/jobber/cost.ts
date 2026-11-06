import type { DocumentNode, FieldNode, GraphQLNamedType, GraphQLSchema, SelectionSetNode } from "graphql";
import { PER_NODE_FIELDS, requestedSelectionCost } from "./requested-cost.ts";
import { type Context, collectFields, fieldsOf, fieldType, isConnection, operationOf, rootType } from "./selections.ts";

/**
 * Jobber's query cost, exactly as documented:
 * https://developer.getjobber.com/docs/using_jobbers_api/api_rate_limits (Cost Calculation, Connection Fields)
 *
 *   - Every field costs 1 point, except `edges`, `nodes`, `node`, and the connection field itself, which cost 0.
 *   - Fields under `nodes` or `edges` are charged once per node: multiplied by the connection's `first` or
 *     `last` argument, or by 100 when neither is given ("the maximum number of fields will be returned").
 *     A negative page size counts as 0, as it does when the connection is resolved, so it can't lower the cost.
 *   - Nested connections multiply, which is why deep nesting gets expensive fast.
 *
 * requestedQueryCost applies these rules to the query; actualQueryCost applies them to the data that came
 * back, so asking for 50 quotes when only 2 exist costs the 2. Jobber deducts the actual cost.
 * Where the docs are silent (connection-level fields like pageInfo, plain lists, fragments on abstract
 * types) the twin charges each field once; FIDELITY.md marks those as approximate. Like any GraphQL server, it
 * reads variables with their declared defaults and leaves out what `@skip` and `@include` leave out.
 */

/** The published budget: 10,000 points per app and account, restoring at 500 points per second. */
export const COST_LIMITS = { capacity: 10_000, restorePerSecond: 500 };

export function requestedQueryCost(
  schema: GraphQLSchema,
  document: DocumentNode,
  variables: Record<string, unknown>,
  operationName?: string,
): number | undefined {
  const { operation, context } = operationOf(schema, document, variables, operationName);
  return operation ? requestedSelectionCost(fieldsOf([operation.selectionSet], context), rootType(schema, operation), context) : 0;
}

export function actualQueryCost(
  schema: GraphQLSchema,
  document: DocumentNode,
  variables: Record<string, unknown>,
  data: unknown,
  operationName?: string,
): number {
  const { operation, context } = operationOf(schema, document, variables, operationName);
  return operation && data ? actualSelectionCost(operation.selectionSet, rootType(schema, operation), data, context) : 0;
}

// ---------------------------------------------------------------------------------------------------
// actual cost: the same rules, counted over the data that came back

function actualSelectionCost(selectionSet: SelectionSetNode, parentType: GraphQLNamedType, data: unknown, context: Context): number {
  let cost = 0;
  for (const field of collectFields(selectionSet, context)) {
    const key = field.alias?.value ?? field.name.value;
    const value = (data as Record<string, unknown>)[key];
    if (value !== undefined) cost += actualFieldCost(field, parentType, value, context);
  }
  return cost;
}

function actualFieldCost(field: FieldNode, parentType: GraphQLNamedType, value: unknown, context: Context): number {
  const type = fieldType(parentType, field);
  if (!type) return 0;
  if (!field.selectionSet) return 1;
  if (field.name.value === "node") return value === null ? 0 : actualSelectionCost(field.selectionSet, type, value, context);
  if (!isConnection(type)) return value === null ? 1 : 1 + actualSelectionCost(field.selectionSet, type, firstItem(value), context);
  if (value === null) return 0;

  let cost = 0;
  for (const child of collectFields(field.selectionSet, context)) {
    const childValue = (value as Record<string, unknown>)[child.alias?.value ?? child.name.value];
    const childType = fieldType(type, child);
    if (PER_NODE_FIELDS.has(child.name.value) && child.selectionSet && childType && Array.isArray(childValue)) {
      for (const node of childValue) cost += actualSelectionCost(child.selectionSet, childType, node, context);
    } else if (childValue !== undefined) {
      cost += actualFieldCost(child, type, childValue, context);
    }
  }
  return cost;
}

/** Plain lists (like Client.emails) are charged like a single object, matching the requested cost. */
function firstItem(value: unknown): unknown {
  return Array.isArray(value) ? (value[0] ?? {}) : value;
}
