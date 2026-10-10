import { formatMoney } from "../../core/money.ts";
import type { TwinEvent } from "../../core/types.ts";
import type { QboCustomer, QboInvoice, QboItem, QboPayment } from "./types.ts";

/**
 * Every event the QuickBooks twin records. Events carry complete records (the whole customer,
 * not "field X changed"), so apply() stays trivially simple and the log reads on its own.
 */
export type QboEventData =
  | { type: "CompanyCreated"; realmId: string }
  | ({ type: "CustomerCreated"; customer: QboCustomer } & RequestIdentified)
  | ({ type: "CustomerUpdated"; customer: QboCustomer } & RequestIdentified)
  | { type: "ItemCreated"; item: QboItem }
  | ({ type: "InvoiceCreated"; invoice: QboInvoice } & RequestIdentified)
  | ({ type: "InvoiceUpdated"; invoice: QboInvoice } & RequestIdentified)
  | ({ type: "PaymentCreated"; payment: QboPayment } & RequestIdentified);

/**
 * A write's requestid travels on the event the write records, so the answer it got is rebuilt from the log
 * like everything else, and a rewind forgets the requestids of the writes it undoes.
 */
export interface RequestIdentified {
  requestId?: string;
}

/** A logged event, narrowed to this vendor's payloads. The event's `type` tells you which one you have. */
export function asQboEvent(event: TwinEvent): QboEventData {
  return { type: event.type, ...(event.data as object) } as QboEventData;
}

/** One plain-language line per event, used by change lists and the MCP tools. */
export function describeQboEvent(event: TwinEvent): string {
  const data = asQboEvent(event);
  switch (data.type) {
    case "CompanyCreated":
      return `CompanyCreated realm ${data.realmId}`;
    case "CustomerCreated":
    case "CustomerUpdated":
      return `${data.type} Id=${data.customer.Id} "${data.customer.DisplayName}" SyncToken=${data.customer.SyncToken}`;
    case "ItemCreated":
      return `ItemCreated Id=${data.item.Id} "${data.item.Name}" ${data.item.Type} UnitPrice=${data.item.UnitPrice}`;
    case "InvoiceCreated":
    case "InvoiceUpdated": {
      const { Id, DocNumber, CustomerRef, TotalAmt, Balance, SyncToken } = data.invoice;
      const version = data.type === "InvoiceUpdated" ? ` SyncToken=${SyncToken}` : "";
      return `${data.type} Id=${Id} DocNumber=${DocNumber ?? "(none)"} "${CustomerRef.name}" TotalAmt=${formatMoney(TotalAmt)} Balance=${formatMoney(Balance)}${version}`;
    }
    case "PaymentCreated": {
      const { Id, CustomerRef, TotalAmt, UnappliedAmt } = data.payment;
      return `PaymentCreated Id=${Id} "${CustomerRef.name}" TotalAmt=${formatMoney(TotalAmt)} UnappliedAmt=${formatMoney(UnappliedAmt)}`;
    }
  }
}
