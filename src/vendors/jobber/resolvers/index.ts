import type { JobberState } from "../types.ts";
import { clientNode } from "./clients.ts";
import { connection, type PageArgs } from "./connection.ts";
import type { ResolverContext } from "./context.ts";

/**
 * Root resolvers for schema.graphql. Each returns plain objects; a field whose value is a function
 * (like a nested connection) is called by graphql-js with that field's arguments. Everything is a
 * plain function of the current state and the twin's clock, so resolvers are easy to test.
 */
export function createResolvers(state: () => JobberState, nowMs: () => number) {
  const context: ResolverContext = { state, nowMs };

  return {
    account: () => state().account,

    client: ({ id }: { id: string }) => {
      const client = state().clients.get(id);
      return client ? clientNode(client, context) : null;
    },

    clients: (args: PageArgs) => {
      const { clients, clientOrder } = state();
      return connection(clientOrder, args, (id) => clientNode(clients.get(id)!, context));
    },
  };
}
