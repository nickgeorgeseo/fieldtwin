import { execute } from "graphql";
import { Hono } from "hono";
import { checkBearer } from "../../core/auth.ts";
import { LeakyBucket } from "../../core/leaky-bucket.ts";
import type { Twin } from "../../core/twin.ts";
import { actualQueryCost, COST_LIMITS, requestedQueryCost } from "./cost.ts";
import { type GraphQLRequest, prepare, schema } from "./graphql.ts";
import { JOBBER_OAUTH_POLICY, jobberOAuthRoutes } from "./oauth.ts";
import { createResolvers } from "./resolvers/index.ts";
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
  const resolvers = createResolvers(
    () => twin.state<JobberState>("jobber"),
    () => twin.clock.nowMs(),
    (event) => twin.record(event, "api"),
  );

  jobberOAuthRoutes(app, twin);

  app.post("/api/graphql", async (c) => {
    // "If the access token is invalid or expired, the API returns a 401 'Invalid Token Error'."
    const auth = checkBearer(twin, "jobber", JOBBER_OAUTH_POLICY, c.req.header("Authorization"));
    if ("problem" in auth) return c.json({ message: auth.problem === "missing" ? "Unauthorized" : "Invalid Token Error" }, 401);

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
    // Jobber budgets per app and account. The twin has one account, so the budget is the app's: every token
    // the OAuth twin issued to one client_id shares it (in any-token mode, an unknown token is its own app).
    const bucket = twin.rateLimit(`jobber:${auth.app}`, () => new LeakyBucket(COST_LIMITS));
    const available = bucket.check(twin.clock.nowMs());
    const throttleStatus = (currentlyAvailable: number) => ({
      maximumAvailable: COST_LIMITS.capacity,
      currentlyAvailable: Math.floor(currentlyAvailable),
      restoreRate: COST_LIMITS.restorePerSecond,
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
