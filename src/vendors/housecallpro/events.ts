import type { TwinEvent } from "../../core/types.ts";
import type { HcpCompany } from "./types.ts";

/** Every event the Housecall Pro twin records. Events carry complete records, so apply() stays simple. */
export type HcpEventData = { type: "CompanyCreated"; company: HcpCompany };

/** A logged event, narrowed to this vendor's payloads. The event's `type` tells you which one you have. */
export function asHcpEvent(event: TwinEvent): HcpEventData {
  return { type: event.type, ...(event.data as object) } as HcpEventData;
}

/** One plain-language line per event, used by change lists and the MCP tools. */
export function describeHcpEvent(event: TwinEvent): string {
  const data = asHcpEvent(event);
  switch (data.type) {
    case "CompanyCreated":
      return `CompanyCreated "${data.company.name}"`;
  }
}
