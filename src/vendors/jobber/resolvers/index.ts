import type { NewEvent } from "../../../core/types.ts";
import { canonicalId } from "../encoded-id.ts";
import type { JobberState } from "../types.ts";
import { clientNode } from "./clients.ts";
import { connection, type PageArgs } from "./connection.ts";
import type { ResolverContext } from "./context.ts";
import { invoiceNode, invoicesConnection } from "./invoices.ts";
import { jobNode, jobsConnection } from "./jobs.ts";
import { gatherLookups, type Lookups } from "./lookups.ts";
import { createMutations } from "./mutations.ts";
import { quoteNode, quotesConnection } from "./quotes.ts";
import { userNode } from "./users.ts";

/**
 * Root resolvers for the schema in schema/, queries and mutations alike. Each returns plain objects; a field whose value is a function
 * (like a nested connection) is called by graphql-js with that field's arguments. Everything is a
 * plain function of the current state and the twin's clock, so resolvers are easy to test.
 *
 * `recorded` counts the events the twin has recorded. State changes only by recording one, so lookups gathered at one
 * count hold, across requests, until the next. A reset or rewind brings a new state object, which gathers its own.
 */
export function createResolvers(state: () => JobberState, nowMs: () => number, record: (event: NewEvent) => void, recorded: () => number) {
  let gathered: { state: JobberState; recorded: number; lookups: Lookups } | undefined;
  const lookups = () => {
    if (gathered?.state !== state() || gathered.recorded !== recorded()) {
      gathered = { state: state(), recorded: recorded(), lookups: gatherLookups(state()) };
    }
    return gathered.lookups;
  };
  const context: ResolverContext = { state, nowMs, lookups };

  return {
    ...createMutations(context, record),

    account: () => {
      const { id, name } = state().account;
      return { id, name };
    },

    client: ({ id }: { id: string }) => {
      const client = state().clients.get(canonicalId(id));
      return client ? clientNode(client, context) : null;
    },

    clients: (args: PageArgs) => connection([...state().clients.values()], args, (client) => clientNode(client, context)),

    users: (args: PageArgs) => connection([...state().users.values()], args, userNode),

    jobs: (args: PageArgs) => jobsConnection(args, context),

    job: ({ id }: { id: string }) => {
      const job = state().jobs.get(canonicalId(id));
      return job ? jobNode(job, context) : null;
    },

    quotes: (args: PageArgs) => quotesConnection(args, context),

    invoices: (args: PageArgs) => invoicesConnection(args, context),

    invoice: ({ id }: { id: string }) => {
      const invoice = state().invoices.get(canonicalId(id));
      return invoice ? invoiceNode(invoice, context) : null;
    },

    quote: ({ id }: { id: string }) => {
      const quote = state().quotes.get(canonicalId(id));
      return quote ? quoteNode(quote, context) : null;
    },
  };
}
