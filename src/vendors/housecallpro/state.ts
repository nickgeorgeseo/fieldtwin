import type { TwinEvent } from "../../core/types.ts";
import { asHcpEvent } from "./events.ts";
import type { HcpState } from "./types/index.ts";

export function createHcpState(): HcpState {
  return {
    company: {
      id: "",
      name: "",
      phone_number: null,
      support_email: null,
      logo_url: null,
      website: null,
      time_zone: null,
      address: { street: null, street_line_2: null, city: "", state: "", zip: null, country: "US" },
      utcOffsetHours: 0,
    },
    customers: new Map(),
    employees: new Map(),
    jobs: new Map(),
    estimates: new Map(),
    invoices: new Map(),
    invoicesByJob: new Map(),
    counts: {
      customers: 0,
      addresses: 0,
      jobs: 0,
      lineItems: 0,
      appointments: 0,
      notes: 0,
      estimates: 0,
      options: 0,
      invoices: 0,
      payments: 0,
    },
  };
}

/** The only place Housecall Pro state changes. */
export function applyHcpEvent(state: HcpState, event: TwinEvent): void {
  const data = asHcpEvent(event);

  switch (data.type) {
    case "CompanyCreated":
      state.company = data.company;
      return;

    case "CustomerCreated":
      state.customers.set(data.customer.id, data.customer);
      state.counts.customers += 1;
      state.counts.addresses += data.customer.addresses.length;
      return;

    case "CustomerUpdated":
      state.customers.set(data.customer.id, data.customer);
      return;

    case "AddressCreated": {
      // Records are replaced, not edited, so a customer read earlier stays as it was read.
      const customer = state.customers.get(data.customerId)!;
      state.customers.set(customer.id, { ...customer, addresses: [...customer.addresses, data.address] });
      state.counts.addresses += 1;
      return;
    }

    case "EmployeeCreated":
      state.employees.set(data.employee.id, data.employee);
      return;

    case "JobCreated":
      state.jobs.set(data.job.id, data.job);
      state.counts.jobs += 1;
      state.counts.lineItems += data.job.line_items.length;
      state.counts.appointments += data.job.appointments.length;
      state.counts.notes += data.job.notes.length;
      return;

    case "JobUpdated": {
      const before = state.jobs.get(data.job.id)!;
      state.jobs.set(data.job.id, data.job);
      state.counts.lineItems += added(before.line_items, data.job.line_items);
      state.counts.appointments += added(before.appointments, data.job.appointments);
      state.counts.notes += added(before.notes, data.job.notes);
      return;
    }

    case "EstimateCreated": {
      const { estimate } = data;
      state.estimates.set(estimate.id, estimate);
      state.counts.estimates += 1;
      state.counts.options += estimate.options.length;
      state.counts.appointments += estimate.appointments.length;
      state.counts.lineItems += estimate.options.reduce((total, option) => total + option.line_items.length, 0);
      return;
    }

    case "InvoiceCreated": {
      const { invoice } = data;
      state.invoices.set(invoice.id, invoice);
      state.invoicesByJob.set(invoice.job_id, [...(state.invoicesByJob.get(invoice.job_id) ?? []), invoice.id]);
      state.counts.invoices += 1;
      state.counts.payments += invoice.payments.length;
      return;
    }

    case "InvoiceUpdated": {
      const before = state.invoices.get(data.invoice.id)!;
      state.invoices.set(data.invoice.id, data.invoice);
      state.counts.payments += added(before.payments, data.invoice.payments);
      return;
    }

    default:
      throw new Error(`Housecall Pro twin does not know how to apply "${event.type}"`);
  }
}

/** How many of an updated record's parts it didn't have before: what the update added, to number the next one's id. */
function added(before: readonly { id: string }[], after: readonly { id: string }[]): number {
  const had = new Set(before.map((part) => part.id));
  return after.filter((part) => !had.has(part.id)).length;
}
