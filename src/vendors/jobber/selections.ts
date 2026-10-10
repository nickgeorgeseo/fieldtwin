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
  // The variables as execution will see them: declared defaults filled in. If they don't coerce, execution reports it.
  const coerced = getVariableValues(schema, operation?.variableDefinitions ?? [], variables);
  return { operation, context: { schema, variables: coerced.coerced ?? variables, fragments } };
}

export function rootType(schema: GraphQLSchema, operation: OperationDefinitionNode): GraphQLNamedType {
  const root = operation.operation === "mutation" ? schema.getMutationType() : schema.getQueryType();
  if (!root) throw new Error(`The schema has no ${operation.operation} type`);
  return root;
}

/** The fields of a selection set, with fragments and inline fragments flattened in and skipped selections left out. */
export function collectFields(selectionSet: SelectionSetNode, parentType: GraphQLNamedType, context: Context): FieldNode[] {
  const fields: FieldNode[] = [];
  for (const selection of selectionSet.selections) {
    if (!included(selection, context)) continue;
    if (selection.kind === Kind.FIELD) fields.push(selection);
    else if (selection.kind === Kind.INLINE_FRAGMENT) fields.push(...collectFields(selection.selectionSet, parentType, context));
    else {
      const fragment = context.fragments.get(selection.name.value);
      if (fragment) fields.push(...collectFields(fragment.selectionSet, parentType, context));
    }
  }
  return fields;
}

/** Whether `@skip(if: ...)` and `@include(if: ...)` keep a selection in the query. */
function included(selection: FieldNode | InlineFragmentNode | FragmentSpreadNode, context: Context): boolean {
  if (getDirectiveValues(GraphQLSkipDirective, selection, context.variables)?.if === true) return false;
  return getDirectiveValues(GraphQLIncludeDirective, selection, context.variables)?.if !== false;
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
