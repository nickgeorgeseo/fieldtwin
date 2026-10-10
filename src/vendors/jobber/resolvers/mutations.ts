import type { NewEvent } from "../../../core/types.ts";
import { encodeId, nextIdNumber } from "../encoded-id.ts";
import type { JobberClient } from "../types.ts";
import { clientNode } from "./clients.ts";
import type { ResolverContext } from "./context.ts";

/**
 * The only resolvers that change anything. Like REST routes, they validate and decide, then record an
 * event; apply() in state.ts does the rest. A business-rule failure is not an error: it comes back in
 * `userErrors` with HTTP 200, and nothing is recorded.
 * https://developer.getjobber.com/docs/using_jobbers_api/api_queries_and_mutations/ (Mutations)
 */

interface UserError {
  message: string;
  path: string[];
}

interface ClientCreateInput {
  firstName?: string;
  lastName?: string;
  companyName?: string;
  emails?: { description?: string; primary?: boolean; address: string }[];
}

export function createMutations(context: ResolverContext, record: (event: NewEvent) => void) {
  return {
    clientCreate: ({ input }: { input: ClientCreateInput }) => {
      // The documented example: { "message": "Last name is required", "path": ["input", "lastName"] }
      const userErrors: UserError[] = [];
      if (!input.lastName?.trim()) userErrors.push({ message: "Last name is required", path: ["input", "lastName"] });
      if (userErrors.length) return { client: null, userErrors };

      const state = context.state();
      // Names are kept as typed but trimmed, and a blank company name means there is no company.
      const client: JobberClient = {
        id: encodeId("Client", nextIdNumber(state.clients.keys(), "Client")),
        firstName: input.firstName?.trim() ?? "",
        lastName: input.lastName!.trim(),
        companyName: input.companyName?.trim() || null,
        emails: (input.emails ?? []).map((email) => ({ address: email.address, primary: email.primary ?? false })),
        phones: [],
        createdAt: new Date(context.nowMs()).toISOString(),
      };
      record({ vendor: "jobber", type: "ClientCreated", data: { client } });
      return { client: clientNode(client, context), userErrors };
    },
  };
}
