import type { TwinEvent } from "../../core/types.ts";
import { clientName, type JobberClient } from "./types.ts";

/** Every event the Jobber twin records. Events carry complete records, so apply() stays simple. */
export type JobberEventData =
  | { type: "AccountCreated"; account: { id: string; name: string } }
  | { type: "ClientCreated"; client: JobberClient };

/** A logged event, narrowed to this vendor's payloads. The event's `type` tells you which one you have. */
export function asJobberEvent(event: TwinEvent): JobberEventData {
  return { type: event.type, ...(event.data as object) } as JobberEventData;
}

/** One plain-language line per event, used by change lists and the MCP tools. */
export function describeJobberEvent(event: TwinEvent): string {
  const data = asJobberEvent(event);
  switch (data.type) {
    case "AccountCreated":
      return `AccountCreated "${data.account.name}"`;
    case "ClientCreated":
      return `ClientCreated "${clientName(data.client)}"`;
  }
}
