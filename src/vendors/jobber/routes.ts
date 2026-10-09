import { readFileSync } from "node:fs";
import { buildSchema, type DocumentNode, execute, type GraphQLError, parse, validate } from "graphql";
import { Hono } from "hono";
import type { Twin } from "../../core/twin.ts";
import { CostBucket, MAXIMUM_AVAILABLE, RESTORE_RATE_PER_SECOND, estimateQueryCost } from "./cost.ts";
import { createResolvers } from "./resolvers.ts";
import type { JobberState } from "./types.ts";

/**
 * Jobber Developer API: one GraphQL endpoint.
 * Real URL: https://api.getjobber.com/api/graphql
 * Every request needs `Authorization: Bearer ...` and an `X-JOBBER-GRAPHQL-VERSION` header.
 */
export const SUPPORTED_VERSIONS = ["2025-04-16"];

const schema = buildSchema(readFileSync(new URL("./schema.graphql", import.meta.url), "utf8"));

export function jobberRoutes(twin: Twin): Hono {
  const app = new Hono();
  const resolvers = createResolvers(() => twin.state<JobberState>("jobber"));
  const bucket = new CostBucket(); // request bookkeeping, not business state, so it is not in the event log

  app.post("/api/graphql", async (c) => {
    if (!c.req.header("Authorization")?.startsWith("Bearer ")) {
      return c.json({ message: "Unauthorized" }, 401);
    }

    const version = c.req.header("X-JOBBER-GRAPHQL-VERSION");
    if (!version || !SUPPORTED_VERSIONS.includes(version)) {
      return c.json(graphQLError(`Unsupported or missing X-JOBBER-GRAPHQL-VERSION. Supported: ${SUPPORTED_VERSIONS.join(", ")}`, "UNSUPPORTED_VERSION"), 400);
    }

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
    const throttleStatus = { maximumAvailable: MAXIMUM_AVAILABLE, currentlyAvailable: Math.floor(spend.currentlyAvailable), restoreRate: RESTORE_RATE_PER_SECOND };

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
