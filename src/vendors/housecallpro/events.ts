import { formatMoney } from "../../core/money.ts";
import type { TwinEvent } from "../../core/types.ts";
import { linesTotal } from "./amounts.ts";
import {
  customerName,
  type HcpAddress,
  type HcpCompany,
  type HcpCustomer,
  type HcpEmployee,
  type HcpEstimate,
  type HcpInvoice,
  type HcpJob,
} from "./types/index.ts";

/** Every event the Housecall Pro twin records. Events carry complete records, so apply() stays simple. */
export type HcpEventData =
  | { type: "CompanyCreated"; company: HcpCompany }
  | { type: "CustomerCreated"; customer: HcpCustomer }
  | { type: "CustomerUpdated"; customer: HcpCustomer }
  | { type: "AddressCreated"; customerId: string; address: HcpAddress }
  | { type: "EmployeeCreated"; employee: HcpEmployee }
  | { type: "JobCreated"; job: HcpJob }
  | { type: "JobUpdated"; job: HcpJob }
  | { type: "EstimateCreated"; estimate: HcpEstimate }
  | { type: "InvoiceCreated"; invoice: HcpInvoice }
  | { type: "InvoiceUpdated"; invoice: HcpInvoice };

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
    case "CustomerCreated":
    case "CustomerUpdated":
      return `${data.type} ${data.customer.id} "${customerName(data.customer)}"`;
    case "AddressCreated":
      return `AddressCreated ${data.address.id} for ${data.customerId} "${[data.address.street, data.address.city].filter(Boolean).join(", ")}"`;
    case "EmployeeCreated":
      return `EmployeeCreated ${data.employee.id} "${data.employee.first_name} ${data.employee.last_name}" (${data.employee.role})`;
    case "JobCreated":
    case "JobUpdated": {
      const { invoice_number, description, appointments } = data.job;
      const done = appointments.length > 0 && appointments.every((appointment) => appointment.completed_at);
      return `${data.type} #${invoice_number}${description ? ` "${description}"` : ""} ${appointments[0]?.start_time ?? "unscheduled"}${done ? " (complete)" : ""}`;
    }
    case "EstimateCreated": {
      const { estimate_number, options } = data.estimate;
      const approved = options.some((option) => option.approved_at);
      return `EstimateCreated #${estimate_number} ${options.length} option${options.length === 1 ? "" : "s"}${approved ? " (approved)" : ""}`;
    }
    case "InvoiceCreated":
    case "InvoiceUpdated": {
      const { invoice_number, items, paid_at } = data.invoice;
      return `${data.type} #${invoice_number} amount=${formatMoney(linesTotal(items) / 100)}${paid_at ? " (paid)" : ""}`;
    }
  }
}
