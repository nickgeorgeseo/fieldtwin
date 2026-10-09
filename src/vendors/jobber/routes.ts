import { readFileSync } from "node:fs";
import { buildSchema, type DocumentNode, execute, type GraphQLError, parse, validate } from "graphql";
import { Hono } from "hono";
import type { Twin } from "../../core/twin.ts";
import { CostBucket, estimateQueryCost, MAXIMUM_AVAILABLE, RESTORE_RATE_PER_SECOND } from "./cost.ts";
import { createResolvers } from "./resolvers.ts";
import type { JobberState } from "./types.ts";
import { resolveVersion } from "./versions.ts";

/**
 * Jobber Developer API: one GraphQL endpoint.
 * Real URL: https://api.getjobber.com/api/graphql
 * Every request needs `Authorization: Bearer ...` and an `X-JOBBER-GRAPHQL-VERSION` header.
 * https://developer.getjobber.com/docs/using_jobbers_api/api_queries_and_mutations/
 */

const schema = buildSchema(readFileSync(new URL("./schema.graphql", import.meta.url), "utf8"));

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

    const { query, variables = {} } = (await c.req.json()) as { query: string; variables?: Record<string, unknown> };

    let document: DocumentNode;
    try {
      document = parse(query);
    } catch (error) {
      return c.json({ errors: [{ message: (error as GraphQLError).message }] }, 400);
    }
    const validationErrors = validate(schema, document);
    if (validationErrors.length) return c.json({ errors: validationErrors.map((e) => ({ message: e.message })) }, 400);

    // Rate limiting happens before execution, the same order Jobber documents.
    const requestedQueryCost = estimateQueryCost(document, variables);
    const spend = bucket.trySpend(requestedQueryCost, twin.clock.nowMs());
    const throttleStatus = {
      maximumAvailable: MAXIMUM_AVAILABLE,
      currentlyAvailable: Math.floor(spend.currentlyAvailable),
      restoreRate: RESTORE_RATE_PER_SECOND,
    };

    if (!spend.allowed) {
      return c.json({
        ...graphQLError("Throttled", "THROTTLED", "https://developer.getjobber.com/docs/using_jobbers_api/api_rate_limits"),
        extensions: { cost: { requestedQueryCost, actualQueryCost: 0, throttleStatus }, versioning: { version } },
      });
    }

    const result = await execute({ schema, document, rootValue: resolvers, variableValues: variables });
    return c.json({
      ...result,
      extensions: { cost: { requestedQueryCost, actualQueryCost: requestedQueryCost, throttleStatus }, versioning: { version } },
    });
  });

  return app;
}

export function graphQLError(message: string, code: string, documentation?: string) {
  return { errors: [{ message, extensions: { code, ...(documentation && { documentation }) } }] };
}
