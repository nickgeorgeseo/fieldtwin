import type { TwinEvent } from "../../core/types.ts";
import { asJobberEvent } from "./events.ts";
import type { JobberState } from "./types.ts";

export function createJobberState(): JobberState {
  return {
    account: { id: "", name: "", utcOffsetHours: 0 },
    clients: new Map(),
    users: new Map(),
    jobs: new Map(),
    visits: new Map(),
    quotes: new Map(),
  };
}

/** The only place Jobber state changes. */
export function applyJobberEvent(state: JobberState, event: TwinEvent): void {
  const data = asJobberEvent(event);

  switch (data.type) {
    case "AccountCreated":
      state.account = data.account;
      return;

    case "ClientCreated":
      state.clients.set(data.client.id, data.client);
      return;

    case "UserCreated":
      state.users.set(data.user.id, data.user);
      return;

    case "JobCreated":
      state.jobs.set(data.job.id, data.job);
      return;

    case "VisitCreated":
      state.visits.set(data.visit.id, data.visit);
      return;

    case "QuoteCreated":
      state.quotes.set(data.quote.id, data.quote);
      return;

    default:
      throw new Error(`Jobber twin does not know how to apply "${event.type}"`);
  }
}
