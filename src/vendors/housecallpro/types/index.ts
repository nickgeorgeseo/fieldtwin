import type { HcpCompany, HcpCustomer, HcpEmployee } from "./people.ts";
import type { HcpEstimate, HcpInvoice, HcpJob } from "./work.ts";

/**
 * Housecall Pro records as the twin stores them, in two files: people.ts (the company, customers, and employees) and
 * work.ts (jobs, estimates, and invoices). Names follow the public API reference, snake_case and all:
 * https://docs.housecallpro.com/docs/housecall-public-api/a4ca20a18010c-housecall-v1-api
 */
export * from "./people.ts";
export * from "./work.ts";

export interface HcpState {
  company: HcpCompany;
  // Maps keep insertion order: the order records were created, which sorts break ties by.
  customers: Map<string, HcpCustomer>;
  employees: Map<string, HcpEmployee>;
  jobs: Map<string, HcpJob>;
  estimates: Map<string, HcpEstimate>;
  invoices: Map<string, HcpInvoice>;
  invoicesByJob: Map<string, string[]>; // a job's invoice ids, kept by apply() so a job never searches every invoice
  // How many of each have been created, to number the next one's id (ids.ts).
  counts: {
    customers: number;
    addresses: number;
    jobs: number;
    lineItems: number;
    appointments: number;
    estimates: number;
    options: number;
    invoices: number;
    payments: number;
  };
}
