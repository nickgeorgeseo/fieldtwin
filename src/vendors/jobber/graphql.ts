import { readdirSync, readFileSync } from "node:fs";
import {
  buildSchema,
  type DocumentNode,
  type GraphQLError,
  type GraphQLFormattedError,
  GraphQLScalarType,
  getLocation,
  getVariableValues,
  Kind,
  type OperationDefinitionNode,
  parse,
  print,
  type TypeNode,
  validate,
} from "graphql";
import { isObject, shown } from "../../core/request-body.ts";
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

/**
 * The GraphQL request a parsed JSON body holds, or what's wrong with it. The docs don't show Jobber's answer to a
 * malformed body; the twin answers 400 with a GraphQL error saying what to send (see FIDELITY.md).
 */
export function graphQLRequestFrom(body: Record<string, unknown>): GraphQLRequest | { problem: string } {
  const { query, variables, operationName } = body;
  if (typeof query !== "string") return { problem: 'query must be a string holding the GraphQL document, like "{ account { id } }".' };
  if (variables != null && !isObject(variables)) {
    return { problem: 'variables must be a JSON object, like {"id": "..."}, not a string or a list.' };
  }
  if (operationName != null && typeof operationName !== "string") return { problem: "operationName must be a string." };
  return { query, variables: variables ?? {}, operationName: operationName ?? undefined };
}

export function prepare(request: GraphQLRequest): { document: DocumentNode } | { errors: GraphQLFormattedError[] } {
  let document: DocumentNode;
  try {
    document = parse(request.query);
  } catch (error) {
    return { errors: [formatted(error)] };
  }

  // A chain of fragments, each spreading the next, parses flat but validates recursively, and can run out of stack:
  // that is the client's query being too deep, so it gets an error like a parse failure does, not a 500.
  let validationErrors: readonly GraphQLError[];
  try {
    validationErrors = validate(schema, document);
  } catch (error) {
    if (!(error instanceof RangeError)) throw error;
    return { errors: [{ message: `The query is nested too deeply to validate (${error.message}). Spread fragments less deeply.` }] };
  }
  if (validationErrors.length) return { errors: validationErrors.map((error) => error.toJSON()) };

  const operation = chosenOperation(document, request.operationName);
  const variableErrors = encodedIdVariableErrors(document, operation, request);
  if (variableErrors.length) return { errors: variableErrors };

  // Variables that don't coerce are an error before anything runs, so they are reported before the cost is priced:
  // priced from their raw values, a page size of "5" would count as 100 and throttle a query that should say why.
  const coerced = getVariableValues(schema, operation?.variableDefinitions ?? [], request.variables);
  if (coerced.errors) return { errors: coerced.errors.map((error) => error.toJSON()) };
  return { document };
}

/** The operation the request runs: the one named by operationName, or the first. */
function chosenOperation(document: DocumentNode, operationName: string | undefined): OperationDefinitionNode | undefined {
  return document.definitions.find(
    (definition): definition is OperationDefinitionNode =>
      definition.kind === Kind.OPERATION_DEFINITION && (!operationName || definition.name?.value === operationName),
  );
}

/**
 * Jobber's documented error for a variable that is not an EncodedId:
 * https://developer.getjobber.com/docs/using_jobbers_api/handling_api_errors/ (Scalar Coercion)
 * graphql-js would also reject it, but with differently worded messages, so the twin checks first.
 */
function encodedIdVariableErrors(
  document: DocumentNode,
  operation: OperationDefinitionNode | undefined,
  request: GraphQLRequest,
): GraphQLFormattedError[] {
  const errors: GraphQLFormattedError[] = [];
  for (const definition of operation?.variableDefinitions ?? []) {
    const name = definition.variable.name.value;
    const value = request.variables[name];
    if (value === undefined || value === null || namedType(definition.type) !== "EncodedId") continue;

    // Only a variable declared as a list holds items to check one by one. A list sent for a single EncodedId is wrong
    // for being a list, even when it holds a valid id, so the problem says that rather than calling the id invalid.
    const isList = listType(definition.type);
    const values = isList && Array.isArray(value) ? value : [value];
    const problems = values.flatMap((item, index) => {
      if (isEncodedId(item)) return [];
      const message =
        !isList && Array.isArray(item)
          ? `Expected one EncodedId, not a list. Send the id itself, like "Z2lkOi8vSm9iYmVyL0NsaWVudC8x".`
          : invalidEncodedIdMessage(item);
      return [{ path: isList && Array.isArray(value) ? [index] : [], explanation: message, message }];
    });
    if (!problems.length) continue;

    const { line, column } = getLocation(document.loc!.source, definition.loc!.start);
    errors.push({
      message: `Variable $${name} of type ${print(definition.type)} was provided invalid value`,
      locations: [{ line, column }],
      extensions: { value: echoed(value), problems },
    });
  }
  return errors;
}

/** The value as sent, to echo back in the error, unless it's nested too deeply for the answer's JSON to hold it. */
function echoed(value: unknown): unknown {
  try {
    JSON.stringify(value);
    return value;
  } catch {
    return shown(value);
  }
}

function namedType(type: TypeNode): string {
  return type.kind === Kind.NAMED_TYPE ? type.name.value : namedType(type.type);
}

/** Whether a declared type is a list, like `[EncodedId!]!`, rather than a single value. */
function listType(type: TypeNode): boolean {
  return type.kind === Kind.NON_NULL_TYPE ? type.type.kind === Kind.LIST_TYPE : type.kind === Kind.LIST_TYPE;
}

function formatted(error: unknown): GraphQLFormattedError {
  const withJson = error as { toJSON?: () => GraphQLFormattedError; message?: string };
  return withJson.toJSON ? withJson.toJSON() : { message: String(withJson.message ?? error) };
}
