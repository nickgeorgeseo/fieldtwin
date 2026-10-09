import type { TwinEvent } from "../../core/types.ts";
import {
  clientName,
  type JobberAccount,
  type JobberClient,
  type JobberInvoice,
  type JobberJob,
  type JobberQuote,
  type JobberUser,
  type JobberVisit,
} from "./types.ts";

/** Every event the Jobber twin records. Events carry complete records, so apply() stays simple. */
export type JobberEventData =
  | { type: "AccountCreated"; account: JobberAccount }
  | { type: "ClientCreated"; client: JobberClient }
  | { type: "UserCreated"; user: JobberUser }
  | { type: "JobCreated"; job: JobberJob }
  | { type: "VisitCreated"; visit: JobberVisit }
  | { type: "QuoteCreated"; quote: JobberQuote }
  | { type: "InvoiceCreated"; invoice: JobberInvoice }
  | { type: "InvoiceUpdated"; invoice: JobberInvoice };

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
    case "UserCreated":
      return `UserCreated "${data.user.name.full}"`;
    case "JobCreated":
      return `JobCreated #${data.job.jobNumber} "${data.job.title}"`;
    case "VisitCreated":
      return `VisitCreated "${data.visit.title}" ${data.visit.startAt}${data.visit.completedAt ? " (completed)" : ""}`;
    case "QuoteCreated":
      return `QuoteCreated #${data.quote.quoteNumber} "${data.quote.title}"`;
    case "InvoiceCreated":
    case "InvoiceUpdated":
      return `${data.type} #${data.invoice.invoiceNumber} "${data.invoice.subject}"${data.invoice.paidAt ? " (paid)" : ""}`;
  }
}
