import { type Answer, type ConformanceCase, jobber, type Observations, unique } from "../case.ts";

/**
 * Jobber cases, one per FIDELITY.md row the twin can't confirm from the docs alone. Run them against a Jobber
 * developer testing account. The one write creates (or is refused) a client named "fieldtwin conformance ...".
 */

/** How Jobber answered, without its wording: the status, whether it sent data or errors, and the error code. */
function answerOf(answer: Answer): Observations {
  const errors = answer.body?.errors;
  return {
    status: answer.status,
    answeredWith: answer.body?.data ? "data" : Array.isArray(errors) ? "errors" : "other",
    errorCode: errors?.[0]?.extensions?.code ?? null,
  };
}

/** Whether a root query exists, and answers with a count, without needing any particular data. */
async function rootQueryWorks(target: Parameters<ConformanceCase["observe"]>[0], field: string): Promise<Observations> {
  const answer = await jobber(target, `{ ${field}(first: 1) { totalCount } }`);
  return { ...answerOf(answer), totalCountIsNumber: typeof answer.body?.data?.[field]?.totalCount === "number" };
}

export const jobberCases: ConformanceCase[] = [
  {
    name: "missing-version-header",
    vendor: "jobber",
    endpoint: "POST /api/graphql",
    fidelity: "Missing or unknown version header",
    observe: async (target) => answerOf(await jobber(target, "{ account { id } }", { version: null })),
  },
  {
    name: "unknown-version-header",
    vendor: "jobber",
    endpoint: "POST /api/graphql",
    fidelity: "Missing or unknown version header",
    observe: async (target) => answerOf(await jobber(target, "{ account { id } }", { version: "1999-01-01" })),
  },
  {
    name: "unknown-access-token",
    vendor: "jobber",
    endpoint: "POST /api/graphql",
    fidelity: "Expired or unknown token on the API",
    async observe(target) {
      const answer = await jobber(target, "{ account { id } }", { token: "fieldtwin-not-a-token" });
      return { status: answer.status, bodyKeys: Object.keys(answer.body ?? {}).sort(), message: answer.body?.message ?? null };
    },
  },
  {
    name: "syntax-error",
    vendor: "jobber",
    endpoint: "POST /api/graphql",
    fidelity: "Syntax and validation errors",
    async observe(target) {
      const answer = await jobber(target, "{ account { id ");
      return { ...answerOf(answer), hasLocations: Array.isArray(answer.body?.errors?.[0]?.locations) };
    },
  },
  {
    name: "body-not-json",
    vendor: "jobber",
    endpoint: "POST /api/graphql",
    fidelity: "A body that isn't a GraphQL request",
    async observe(target) {
      const response = await target.fetch(target.jobber.apiUrl, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${target.jobber.accessToken}`,
          "Content-Type": "application/json",
          "X-JOBBER-GRAPHQL-VERSION": "2025-04-16",
        },
        body: "{not json",
      });
      return answerOf({ status: response.status, body: await response.json().catch(() => null) });
    },
  },
  {
    name: "variables-as-a-string",
    vendor: "jobber",
    endpoint: "POST /api/graphql",
    fidelity: "A body that isn't a GraphQL request",
    async observe(target) {
      const response = await target.fetch(target.jobber.apiUrl, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${target.jobber.accessToken}`,
          "Content-Type": "application/json",
          "X-JOBBER-GRAPHQL-VERSION": "2025-04-16",
        },
        body: JSON.stringify({ query: "query First($n: Int) { clients(first: $n) { totalCount } }", variables: '{"n": 1}' }),
      });
      return answerOf({ status: response.status, body: await response.json().catch(() => null) });
    },
  },
  {
    name: "encoded-id-format",
    vendor: "jobber",
    endpoint: "POST /api/graphql",
    fidelity: "Base64 padding on ids",
    async observe(target): Promise<Observations> {
      // Whether an id is padded only shows when its length needs padding, so look at the first id that does.
      const answer = await jobber(target, "{ clients(first: 20) { nodes { id } } }");
      const ids: string[] = (answer.body?.data?.clients?.nodes ?? []).map((node: { id: string }) => node.id);
      // An empty account has no ids to look at, and an observation of that could never match the twin's.
      if (!ids.length) throw new Error("The account has no clients, so there are no ids to look at. Create a client in it first.");
      const decodedPrefix = Buffer.from(ids[0]!, "base64").toString().replace(/\d+$/, "");
      // Recordings hold no account data: record the prefix only if it is the documented gid://Jobber/Type/ form.
      if (!/^gid:\/\/Jobber\/\w+\/$/.test(decodedPrefix))
        throw new Error("Ids don't decode to gid://Jobber/Type/n, so this case can't tell.");
      for (const id of ids) {
        const padded = Buffer.from(Buffer.from(id, "base64").toString()).toString("base64");
        if (padded.endsWith("=")) return { decodedPrefix, padding: id === padded ? "padded" : "unpadded" };
      }
      return { decodedPrefix, padding: "not needed by any id seen" };
    },
  },
  {
    name: "account-cost",
    vendor: "jobber",
    endpoint: "POST /api/graphql",
    fidelity: "The docs' own sample response",
    async observe(target) {
      const answer = await jobber(target, "{ account { id name } }");
      return { requestedQueryCost: answer.body?.extensions?.cost?.requestedQueryCost ?? null };
    },
  },
  {
    name: "connection-extras-cost",
    vendor: "jobber",
    endpoint: "POST /api/graphql",
    fidelity: "Cost of pageInfo, totalCount, plain lists, __typename",
    async observe(target) {
      const answer = await jobber(
        target,
        "{ clients(first: 10) { totalCount pageInfo { hasNextPage endCursor } nodes { id __typename } } }",
      );
      return { requestedQueryCost: answer.body?.extensions?.cost?.requestedQueryCost ?? null };
    },
  },
  {
    name: "root-invoices-query",
    vendor: "jobber",
    endpoint: "POST /api/graphql",
    fidelity: "invoices, invoice, Client.invoices, Job.invoices",
    observe: (target) => rootQueryWorks(target, "invoices"),
  },
  {
    name: "root-users-query",
    vendor: "jobber",
    endpoint: "POST /api/graphql",
    fidelity: "users",
    observe: (target) => rootQueryWorks(target, "users"),
  },
  {
    name: "client-create-company-only",
    vendor: "jobber",
    endpoint: "POST /api/graphql (clientCreate)",
    fidelity: "clientCreate details",
    writes: true,
    async observe(target) {
      const mutation = `mutation ($input: ClientCreateInput!) {
        clientCreate(input: $input) { client { id } userErrors { message path } }
      }`;
      const answer = await jobber(target, mutation, { variables: { input: { companyName: unique("company") } } });
      const result = answer.body?.data?.clientCreate;
      if (!result) return answerOf(answer);
      return { created: result.client !== null, userErrors: (result.userErrors ?? []).map((error: { path: string[] }) => error.path) };
    },
  },
];
