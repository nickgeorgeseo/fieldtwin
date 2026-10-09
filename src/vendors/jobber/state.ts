import type { TwinEvent } from "../../core/types.ts";
import { asJobberEvent } from "./events.ts";
import type { JobberState } from "./types.ts";

export function createJobberState(): JobberState {
  return { account: { id: "", name: "" }, clients: new Map(), clientOrder: [] };
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
      state.clientOrder.push(data.client.id);
      return;

    default:
      throw new Error(`Jobber twin does not know how to apply "${event.type}"`);
  }
}
