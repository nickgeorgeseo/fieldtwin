import {
  type DocumentNode,
  type FieldNode,
  type FragmentDefinitionNode,
  type GraphQLNamedType,
  type GraphQLSchema,
  getNamedType,
  isInterfaceType,
  isObjectType,
  Kind,
  type OperationDefinitionNode,
  type SelectionSetNode,
  type ValueNode,
} from "graphql";

/**
 * Jobber's query cost, exactly as documented:
 * https://developer.getjobber.com/docs/using_jobbers_api/api_rate_limits (Cost Calculation, Connection Fields)
 *
 *   - Every field costs 1 point, except `edges`, `nodes`, `node`, and the connection field itself, which cost 0.
 *   - Fields under `nodes` or `edges` are charged once per node: multiplied by the connection's `first` or
 *     `last` argument, or by 100 when neither is given ("the maximum number of fields will be returned").
 *   - Nested connections multiply, which is why deep nesting gets expensive fast.
 *
 * requestedQueryCost applies these rules to the query; actualQueryCost applies them to the data that came
 * back, so asking for 50 quotes when only 2 exist costs the 2. Jobber deducts the actual cost.
 * Where the docs are silent (connection-level fields like pageInfo, plain lists, fragments on abstract
 * types) the twin charges each field once; FIDELITY.md marks those as approximate.
 */

export const ASSUMED_PAGE_SIZE = 100; // "All connection fields are configured to return a maximum of 100 nodes"

/** The published budget: 10,000 points per app and account, restoring at 500 points per second. */
export const COST_LIMITS = { capacity: 10_000, restorePerSecond: 500 };

const PER_NODE_FIELDS = new Set(["nodes", "edges"]);

interface Context {
  schema: GraphQLSchema;
  variables: Record<string, unknown>;
  fragments: Map<string, FragmentDefinitionNode>;
}

export function requestedQueryCost(
  schema: GraphQLSchema,
  document: DocumentNode,
  variables: Record<string, unknown>,
  operationName?: string,
): number {
  const { operation, context } = start(schema, document, variables, operationName);
  return operation ? selectionCost(operation.selectionSet, rootType(schema, operation), 1, context) : 0;
}

export function actualQueryCost(
  schema: GraphQLSchema,
  document: DocumentNode,
  variables: Record<string, unknown>,
  data: unknown,
  operationName?: string,
): number {
  const { operation, context } = start(schema, document, variables, operationName);
  return operation && data ? actualSelectionCost(operation.selectionSet, rootType(schema, operation), data, context) : 0;
}

// ---------------------------------------------------------------------------------------------------
// requested cost: what the query could cost, before it runs

function selectionCost(selectionSet: SelectionSetNode, parentType: GraphQLNamedType, multiplier: number, context: Context): number {
  let cost = 0;
  for (const field of collectFields(selectionSet, parentType, context)) cost += fieldCost(field, parentType, multiplier, context);
  return cost;
}

function fieldCost(field: FieldNode, parentType: GraphQLNamedType, multiplier: number, context: Context): number {
  const type = fieldType(parentType, field);
  if (!type) return 0; // __typename and other meta fields
  if (!field.selectionSet) return multiplier; // a scalar or enum: 1 point
  if (field.name.value === "node") return selectionCost(field.selectionSet, type, multiplier, context); // edge.node is free
  if (!isConnection(type)) return multiplier + selectionCost(field.selectionSet, type, multiplier, context);

  // The connection field is free. Per-node fields are multiplied by the page size; the rest are charged once.
  const pageSize = requestedPageSize(field, context);
  let cost = 0;
  for (const child of collectFields(field.selectionSet, type, context)) {
    const childType = fieldType(type, child);
    cost +=
      PER_NODE_FIELDS.has(child.name.value) && child.selectionSet && childType
        ? selectionCost(child.selectionSet, childType, multiplier * pageSize, context)
        : fieldCost(child, type, multiplier, context);
  }
  return cost;
}

function requestedPageSize(field: FieldNode, context: Context): number {
  for (const name of ["first", "last"]) {
    const argument = field.arguments?.find((candidate) => candidate.name.value === name);
    const size = argument && readInt(argument.value, context.variables);
    if (size !== undefined) return size;
  }
  return ASSUMED_PAGE_SIZE;
}

// ---------------------------------------------------------------------------------------------------
// actual cost: the same rules, counted over the data that came back

function actualSelectionCost(selectionSet: SelectionSetNode, parentType: GraphQLNamedType, data: unknown, context: Context): number {
  let cost = 0;
  for (const field of collectFields(selectionSet, parentType, context)) {
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
  for (const child of collectFields(field.selectionSet, type, context)) {
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

// ---------------------------------------------------------------------------------------------------
// shared helpers

function start(schema: GraphQLSchema, document: DocumentNode, variables: Record<string, unknown>, operationName?: string) {
  const fragments = new Map<string, FragmentDefinitionNode>();
  let operation: OperationDefinitionNode | undefined;
  for (const definition of document.definitions) {
    if (definition.kind === Kind.FRAGMENT_DEFINITION) fragments.set(definition.name.value, definition);
    if (definition.kind === Kind.OPERATION_DEFINITION && (!operationName || definition.name?.value === operationName)) {
      operation ??= definition;
    }
  }
  return { operation, context: { schema, variables, fragments } };
}

function rootType(schema: GraphQLSchema, operation: OperationDefinitionNode): GraphQLNamedType {
  const root = operation.operation === "mutation" ? schema.getMutationType() : schema.getQueryType();
  if (!root) throw new Error(`The schema has no ${operation.operation} type`);
  return root;
}

/** The fields of a selection set, with fragments and inline fragments flattened in. */
function collectFields(selectionSet: SelectionSetNode, parentType: GraphQLNamedType, context: Context): FieldNode[] {
  const fields: FieldNode[] = [];
  for (const selection of selectionSet.selections) {
    if (selection.kind === Kind.FIELD) fields.push(selection);
    else if (selection.kind === Kind.INLINE_FRAGMENT) fields.push(...collectFields(selection.selectionSet, parentType, context));
    else {
      const fragment = context.fragments.get(selection.name.value);
      if (fragment) fields.push(...collectFields(fragment.selectionSet, parentType, context));
    }
  }
  return fields;
}

function fieldType(parentType: GraphQLNamedType, field: FieldNode): GraphQLNamedType | undefined {
  if (!isObjectType(parentType) && !isInterfaceType(parentType)) return undefined;
  const definition = parentType.getFields()[field.name.value];
  return definition && getNamedType(definition.type);
}

function isConnection(type: GraphQLNamedType): boolean {
  return type.name.endsWith("Connection");
}

function readInt(value: ValueNode, variables: Record<string, unknown>): number | undefined {
  if (value.kind === Kind.INT) return Number(value.value);
  if (value.kind === Kind.VARIABLE) {
    const variable = variables[value.name.value];
    return typeof variable === "number" ? variable : undefined;
  }
  return undefined;
}
