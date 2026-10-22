import type { Books, HcpCustomer, JobberClient } from "./books.ts";
import { hcpLinesCents } from "./hcp-amounts.ts";
import type { FieldService } from "./vendors.ts";

/**
 * A field-service system's customers and invoices, read into the terms they are compared with the books in: a
 * customer's name and email, and an invoice's number, customer, total in cents, and whether it is paid
 * (match-books.ts compares them).
 */
export interface FieldServiceRecords {
  customers: { id: string; name: string; email: string }[];
  invoices: { number: string; customerId: string; cents: number; paid: boolean }[];
}

export function fieldServiceRecords(books: Books, service: FieldService): FieldServiceRecords {
  if (service === "jobber") {
    return {
      customers: books.jobber.clients.map((client) => ({ id: client.id, name: clientName(client), email: clientEmail(client) })),
      invoices: books.jobber.invoices.map((invoice) => ({
        number: invoice.invoiceNumber,
        customerId: invoice.clientId,
        cents: Math.round(invoice.lineItems.reduce((sum, line) => sum + line.totalPrice, 0) * 100),
        paid: invoice.paidAt !== null,
      })),
    };
  }
  return {
    customers: books.housecallpro.customers.map((customer) => ({
      id: customer.id,
      name: hcpCustomerName(customer),
      email: customer.email?.toLowerCase() ?? "",
    })),
    invoices: books.housecallpro.invoices.map((invoice) => ({
      number: invoice.invoice_number,
      customerId: invoice.customer_id,
      cents: hcpLinesCents(invoice.items), // Housecall Pro counts in cents; Jobber's lines above are dollars
      paid: invoice.paid_at !== null,
    })),
  };
}

function clientEmail(client: JobberClient): string {
  return (client.emails.find((email) => email.primary) ?? client.emails[0])?.address.toLowerCase() ?? "";
}

/** How Jobber shows a client: their name, or failing that their company. */
export function clientName(client: Pick<JobberClient, "firstName" | "lastName" | "companyName">): string {
  return [client.firstName, client.lastName].filter(Boolean).join(" ") || client.companyName || "";
}

/** How Housecall Pro shows a customer: their name, or failing that their company, email, or a phone number. */
export function hcpCustomerName(customer: Omit<HcpCustomer, "id">): string {
  const name = [customer.first_name, customer.last_name].filter(Boolean).join(" ");
  return name || customer.company || customer.email || customer.mobile_number || customer.home_number || customer.work_number || "";
}
