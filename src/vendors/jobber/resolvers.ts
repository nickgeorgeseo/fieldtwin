import type { JobberClient, JobberState } from "./types.ts";

/**
 * Resolvers for schema.graphql. Each one is a plain function of the current state,
 * so you can unit test them without HTTP or GraphQL in the way.
 */
export function createResolvers(getState: () => JobberState) {
  return {
    account: () => getState().account,

    client: ({ id }: { id: string }) => {
      const client = getState().clients.get(id);
      return client ? toGraphQL(client) : null;
    },

    clients: ({ first = 100, after }: { first?: number; after?: string }) => {
      const state = getState();
      const start = after ? decodeCursor(after) + 1 : 0;
      const ids = state.clientOrder.slice(start, start + first);
      const lastIndex = start + ids.length - 1;

      return {
        nodes: ids.map((id) => toGraphQL(state.clients.get(id)!)),
        totalCount: state.clientOrder.length,
        pageInfo: {
          hasNextPage: lastIndex < state.clientOrder.length - 1,
          endCursor: ids.length ? encodeCursor(lastIndex) : null,
        },
      };
    },
  };
}

function toGraphQL(client: JobberClient) {
  return { ...client, name: client.companyName ?? `${client.firstName} ${client.lastName}` };
}

// Cursors are opaque to callers. Inside the twin, a cursor is just a position in clientOrder.
function encodeCursor(index: number): string {
  return Buffer.from(`cursor:${index}`).toString("base64");
}

function decodeCursor(cursor: string): number {
  return Number(Buffer.from(cursor, "base64").toString().replace("cursor:", ""));
}
