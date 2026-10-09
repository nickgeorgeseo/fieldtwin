import type { JobberState } from "../types.ts";
import { clientNode } from "./clients.ts";
import { connection, type PageArgs } from "./connection.ts";
import type { ResolverContext } from "./context.ts";
import { jobNode, jobsConnection } from "./jobs.ts";
import { userNode } from "./users.ts";

/**
 * Root resolvers for schema.graphql. Each returns plain objects; a field whose value is a function
 * (like a nested connection) is called by graphql-js with that field's arguments. Everything is a
 * plain function of the current state and the twin's clock, so resolvers are easy to test.
 */
export function createResolvers(state: () => JobberState, nowMs: () => number) {
  const context: ResolverContext = { state, nowMs };

  return {
    account: () => {
      const { id, name } = state().account;
      return { id, name };
    },

    client: ({ id }: { id: string }) => {
      const client = state().clients.get(id);
      return client ? clientNode(client, context) : null;
    },

    clients: (args: PageArgs) => connection([...state().clients.values()], args, (client) => clientNode(client, context)),

    users: (args: PageArgs) => connection([...state().users.values()], args, userNode),

    jobs: (args: PageArgs) => jobsConnection(args, context),

    job: ({ id }: { id: string }) => {
      const job = state().jobs.get(id);
      return job ? jobNode(job, context) : null;
    },
  };
}
