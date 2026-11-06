import {
  type DocumentNode,
  type FieldNode,
  type FragmentDefinitionNode,
  type FragmentSpreadNode,
  GraphQLIncludeDirective,
  type GraphQLNamedType,
  type GraphQLSchema,
  GraphQLSkipDirective,
  getDirectiveValues,
  getNamedType,
  getVariableValues,
  type InlineFragmentNode,
  isInterfaceType,
  isObjectType,
  Kind,
  type OperationDefinitionNode,
  type SelectionNode,
  type SelectionSetNode,
  type ValueNode,
} from "graphql";

/**
 * Reading a query's selections the way execution will: the operation asked for, variables with their declared
 * defaults, fragments flattened in, and what `@skip` and `@include` leave out. cost.ts prices what these find.
 */
export interface Context {
  schema: GraphQLSchema;
  variables: Record<string, unknown>;
  fragments: Map<string, FragmentDefinitionNode>;
}

/** The operation a request runs, and the context its selections are read in. */
export function operationOf(schema: GraphQLSchema, document: DocumentNode, variables: Record<string, unknown>, operationName?: string) {
  const fragments = new Map<string, FragmentDefinitionNode>();
  let operation: OperationDefinitionNode | undefined;
  for (const definition of document.definitions) {
    if (definition.kind === Kind.FRAGMENT_DEFINITION) fragments.set(definition.name.value, definition);
    if (definition.kind === Kind.OPERATION_DEFINITION && (!operationName || definition.name?.value === operationName)) {
      operation ??= definition;
    }
  }
  // The variables as execution will see them: declared defaults filled in. prepare() has already answered variables
  // that don't coerce; their raw values are never priced, since a page size of "5" or 2.5 isn't one.
  const coerced = getVariableValues(schema, operation?.variableDefinitions ?? [], variables);
  return { operation, context: { schema, variables: coerced.coerced ?? {}, fragments } };
}

export function rootType(schema: GraphQLSchema, operation: OperationDefinitionNode): GraphQLNamedType {
  const root = operation.operation === "mutation" ? schema.getMutationType() : schema.getQueryType();
  if (!root) throw new Error(`The schema has no ${operation.operation} type`);
  return root;
}

/**
 * The fields of a selection set, with fragments and inline fragments flattened in and skipped selections left out,
 * one per response key (alias or name). Execution merges fields that share a key, so `id` selected directly and
 * again in a fragment comes back once, and is priced once; the sub-selections of a repeated field are merged too.
 */
export function collectFields(selectionSet: SelectionSetNode, context: Context): FieldNode[] {
  const byKey = new Map<string, FieldNode[]>();
  for (const field of allFields(selectionSet, context)) {
    const key = field.alias?.value ?? field.name.value;
    const sameKey = byKey.get(key);
    if (sameKey) sameKey.push(field);
    else byKey.set(key, [field]);
  }
  // Validation guarantees fields sharing a key have the same name and arguments, so only their selections differ.
  return [...byKey.values()].map((fields) => {
    const first = fields[0]!;
    if (!first.selectionSet || fields.length === 1) return first;
    return {
      ...first,
      selectionSet: { ...first.selectionSet, selections: fields.flatMap((field) => field.selectionSet?.selections ?? []) },
    };
  });
}

/**
 * Every field a selection set holds, in order, through its fragments. A stack of selections still to read rather
 * than recursion: a chain of thousands of nested fragments can pass validation, and walking it recursively would
 * run out of stack and answer the request with a 500 instead of the query's own answer.
 */
function allFields(selectionSet: SelectionSetNode, context: Context): FieldNode[] {
  const fields: FieldNode[] = [];
  const pending: SelectionNode[] = [...selectionSet.selections].reverse();
  for (let selection = pending.pop(); selection; selection = pending.pop()) {
    if (!included(selection, context)) continue;
    if (selection.kind === Kind.FIELD) {
      fields.push(selection);
      continue;
    }
    const inner =
      selection.kind === Kind.INLINE_FRAGMENT ? selection.selectionSet : context.fragments.get(selection.name.value)?.selectionSet;
    if (inner) pending.push(...[...inner.selections].reverse());
  }
  return fields;
}

/**
 * Whether `@skip(if: ...)` and `@include(if: ...)` keep a selection in the query. An `if` that is null (a nullable
 * variable sent as null) isn't a Boolean: execution answers that with an error, so pricing counts the selection in
 * rather than throwing, which would answer the request with a 500.
 */
function included(selection: FieldNode | InlineFragmentNode | FragmentSpreadNode, context: Context): boolean {
  try {
    if (getDirectiveValues(GraphQLSkipDirective, selection, context.variables)?.if === true) return false;
    return getDirectiveValues(GraphQLIncludeDirective, selection, context.variables)?.if !== false;
  } catch {
    return true;
  }
}

export function fieldType(parentType: GraphQLNamedType, field: FieldNode): GraphQLNamedType | undefined {
  if (!isObjectType(parentType) && !isInterfaceType(parentType)) return undefined;
  const definition = parentType.getFields()[field.name.value];
  return definition && getNamedType(definition.type);
}

export function isConnection(type: GraphQLNamedType): boolean {
  return type.name.endsWith("Connection");
}

export function readInt(value: ValueNode, variables: Record<string, unknown>): number | undefined {
  if (value.kind === Kind.INT) return Number(value.value);
  if (value.kind === Kind.VARIABLE) {
    const variable = variables[value.name.value];
    return typeof variable === "number" ? variable : undefined;
  }
  return undefined;
}
