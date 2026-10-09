import { readdirSync, readFileSync } from "node:fs";
import {
  buildSchema,
  type DocumentNode,
  type GraphQLFormattedError,
  GraphQLScalarType,
  getLocation,
  Kind,
  type OperationDefinitionNode,
  parse,
  print,
  type TypeNode,
  validate,
} from "graphql";
import { invalidEncodedIdMessage, isEncodedId } from "./encoded-id.ts";

/**
 * Turns a request body into a document that is safe to execute, or the errors Jobber would answer with.
 * Jobber answers these "top-level errors" with HTTP 200 and an `errors` list:
 * https://developer.getjobber.com/docs/using_jobbers_api/api_queries_and_mutations/ (Response structure)
 */

/** The schema, from every file in schema/ (base.graphql defines Query; the others extend it). */
const SCHEMA_DIR = new URL("./schema/", import.meta.url);
export const schema = buildSchema(
  readdirSync(SCHEMA_DIR)
    .filter((file) => file.endsWith(".graphql"))
    .sort()
    .map((file) => readFileSync(new URL(file, SCHEMA_DIR), "utf8"))
    .join("\n"),
);

// Teach the EncodedId scalar from schema/base.graphql to reject values that are not EncodedIds,
// so ids written inline in a query fail validation too.
const encodedIdScalar = schema.getType("EncodedId");
if (!(encodedIdScalar instanceof GraphQLScalarType)) throw new Error("schema/base.graphql must declare scalar EncodedId");
encodedIdScalar.parseValue = (value) => {
  if (!isEncodedId(value)) throw new TypeError(invalidEncodedIdMessage(value));
  return value;
};
encodedIdScalar.parseLiteral = (node) => {
  const value = node.kind === Kind.STRING ? node.value : print(node);
  if (node.kind !== Kind.STRING || !isEncodedId(value)) throw new TypeError(invalidEncodedIdMessage(value));
  return value;
};

export interface GraphQLRequest {
  query: string;
  variables: Record<string, unknown>;
  operationName?: string;
}

export function prepare(request: GraphQLRequest): { document: DocumentNode } | { errors: GraphQLFormattedError[] } {
  let document: DocumentNode;
  try {
    document = parse(request.query);
  } catch (error) {
    return { errors: [formatted(error)] };
  }

  const validationErrors = validate(schema, document);
  if (validationErrors.length) return { errors: validationErrors.map((error) => error.toJSON()) };

  const variableErrors = encodedIdVariableErrors(document, request);
  if (variableErrors.length) return { errors: variableErrors };
  return { document };
}

/**
 * Jobber's documented error for a variable that is not an EncodedId:
 * https://developer.getjobber.com/docs/using_jobbers_api/handling_api_errors/ (Scalar Coercion)
 * graphql-js would also reject it, but with differently worded messages, so the twin checks first.
 */
function encodedIdVariableErrors(document: DocumentNode, request: GraphQLRequest): GraphQLFormattedError[] {
  const operation = document.definitions.find(
    (definition): definition is OperationDefinitionNode =>
      definition.kind === Kind.OPERATION_DEFINITION && (!request.operationName || definition.name?.value === request.operationName),
  );
  const errors: GraphQLFormattedError[] = [];
  for (const definition of operation?.variableDefinitions ?? []) {
    const name = definition.variable.name.value;
    const value = request.variables[name];
    if (value === undefined || value === null || namedType(definition.type) !== "EncodedId") continue;

    const values = Array.isArray(value) ? value : [value];
    const problems = values.flatMap((item, index) => {
      if (isEncodedId(item)) return [];
      const message = invalidEncodedIdMessage(item);
      return [{ path: Array.isArray(value) ? [index] : [], explanation: message, message }];
    });
    if (!problems.length) continue;

    const { line, column } = getLocation(document.loc!.source, definition.loc!.start);
    errors.push({
      message: `Variable $${name} of type ${print(definition.type)} was provided invalid value`,
      locations: [{ line, column }],
      extensions: { value, problems },
    });
  }
  return errors;
}

function namedType(type: TypeNode): string {
  return type.kind === Kind.NAMED_TYPE ? type.name.value : namedType(type.type);
}

function formatted(error: unknown): GraphQLFormattedError {
  const withJson = error as { toJSON?: () => GraphQLFormattedError; message?: string };
  return withJson.toJSON ? withJson.toJSON() : { message: String(withJson.message ?? error) };
}
