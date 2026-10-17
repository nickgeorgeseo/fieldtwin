import { formatMoney } from "../../core/money.ts";
import type { TwinEvent } from "../../core/types.ts";
import { linesTotal } from "./amounts.ts";
import type { HcpAddress, HcpCompany, HcpCustomer, HcpEmployee, HcpInvoice, HcpJob } from "./types.ts";

/** Every event the Housecall Pro twin records. Events carry complete records, so apply() stays simple. */
export type HcpEventData =
  | { type: "CompanyCreated"; company: HcpCompany }
  | { type: "CustomerCreated"; customer: HcpCustomer }
  | { type: "CustomerUpdated"; customer: HcpCustomer }
  | { type: "AddressCreated"; customerId: string; address: HcpAddress }
  | { type: "EmployeeCreated"; employee: HcpEmployee }
  | { type: "JobCreated"; job: HcpJob }
  | { type: "InvoiceCreated"; invoice: HcpInvoice };

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
    case "JobCreated": {
      const { invoice_number, description, appointments } = data.job;
      const done = appointments.length > 0 && appointments.every((appointment) => appointment.completed_at);
      return `JobCreated #${invoice_number} "${description}" ${appointments[0]?.start_time ?? "unscheduled"}${done ? " (complete)" : ""}`;
    }
    case "InvoiceCreated": {
      const { invoice_number, items, paid_at } = data.invoice;
      return `InvoiceCreated #${invoice_number} amount=${formatMoney(linesTotal(items) / 100)}${paid_at ? " (paid)" : ""}`;
    }
  }
}

/** How a person reads a customer: their name, or failing that their company, email, or a phone number. */
export function customerName(customer: HcpCustomer): string {
  const name = [customer.first_name, customer.last_name].filter(Boolean).join(" ");
  return name || customer.company || customer.email || customer.mobile_number || customer.home_number || customer.work_number || "";
}
