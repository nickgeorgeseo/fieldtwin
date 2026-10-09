import { execute } from "graphql";
import { Hono } from "hono";
import type { Twin } from "../../core/twin.ts";
import { actualQueryCost, CostBucket, MAXIMUM_AVAILABLE, RESTORE_RATE_PER_SECOND, requestedQueryCost } from "./cost.ts";
import { type GraphQLRequest, prepare, schema } from "./graphql.ts";
import { createResolvers } from "./resolvers.ts";
import type { JobberState } from "./types.ts";
import { resolveVersion } from "./versions.ts";

/**
 * Jobber Developer API: one GraphQL endpoint.
 * Real URL: https://api.getjobber.com/api/graphql
 * Every request needs `Authorization: Bearer ...` and an `X-JOBBER-GRAPHQL-VERSION` header.
 * https://developer.getjobber.com/docs/using_jobbers_api/api_queries_and_mutations/
 */

export function jobberRoutes(twin: Twin): Hono {
  const app = new Hono();
  const resolvers = createResolvers(() => twin.state<JobberState>("jobber"));
  const bucket = new CostBucket(); // request bookkeeping, not business state, so it is not in the event log

  app.post("/api/graphql", async (c) => {
    if (!c.req.header("Authorization")?.startsWith("Bearer ")) {
      return c.json({ message: "Unauthorized" }, 401);
    }

    // The docs require the header but do not show the response when it is missing or unknown.
    // The twin fails loudly with a 400 (see FIDELITY.md).
    const resolved = resolveVersion(c.req.header("X-JOBBER-GRAPHQL-VERSION"));
    if ("error" in resolved) return c.json(graphQLError(resolved.error, "UNSUPPORTED_VERSION"), 400);
    const { version } = resolved;

    const body = (await c.req.json()) as Partial<GraphQLRequest>;
    const request: GraphQLRequest = { query: body.query ?? "", variables: body.variables ?? {}, operationName: body.operationName };
    const prepared = prepare(request);
    if ("errors" in prepared) return c.json({ errors: prepared.errors });
    const { document } = prepared;

    // Jobber checks the requested cost against the bucket before running the query,
    // then deducts what the query actually cost once it has resolved.
    const requested = requestedQueryCost(schema, document, request.variables, request.operationName);
    const available = bucket.check(twin.clock.nowMs());
    const throttleStatus = (currentlyAvailable: number) => ({
      maximumAvailable: MAXIMUM_AVAILABLE,
      currentlyAvailable: Math.floor(currentlyAvailable),
      restoreRate: RESTORE_RATE_PER_SECOND,
    });

    if (requested > available) {
      return c.json({
        ...graphQLError("Throttled", "THROTTLED", "https://developer.getjobber.com/docs/using_jobbers_api/api_rate_limits"),
        extensions: {
          cost: { requestedQueryCost: requested, actualQueryCost: 0, throttleStatus: throttleStatus(available) },
          versioning: { version },
        },
      });
    }

    const result = await execute({
      schema,
      document,
      rootValue: resolvers,
      variableValues: request.variables,
      operationName: request.operationName,
    });
    const actual = actualQueryCost(schema, document, request.variables, result.data, request.operationName);
    const remaining = bucket.spend(actual);
    return c.json({
      ...result,
      extensions: {
        cost: { requestedQueryCost: requested, actualQueryCost: actual, throttleStatus: throttleStatus(remaining) },
        versioning: { version },
      },
    });
  });

  return app;
}

export function graphQLError(message: string, code: string, documentation?: string) {
  return { errors: [{ message, extensions: { code, ...(documentation && { documentation }) } }] };
}
