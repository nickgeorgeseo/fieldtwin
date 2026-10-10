/**
 * Jobber records as the twin stores them. Shapes follow the public GraphQL schema (camelCase):
 * https://developer.getjobber.com/docs (Important Objects). Statuses are not stored: resolvers derive them
 * from these facts and the twin clock, so they change as time passes, like the real product.
 */

export interface JobberAccount {
  id: string;
  name: string;
  utcOffsetHours: number; // not part of the API; the business's time zone, for "today" and "late"
}

export interface JobberClient {
  id: string; // an EncodedId, see encoded-id.ts
  firstName: string;
  lastName: string;
  companyName: string | null;
  emails: { address: string; primary: boolean }[];
  phones: { number: string; primary: boolean }[];
  createdAt: string;
}

/** Jobber's `Client.name`: the company name for a business client, otherwise the person's name. */
export function clientName(client: JobberClient): string {
  return client.companyName ?? [client.firstName, client.lastName].filter(Boolean).join(" ");
}

/** A user on the account, generally a technician who completes work. */
export interface JobberUser {
  id: string;
  name: { first: string; last: string; full: string };
  email: { raw: string };
  isAccountOwner: boolean;
  createdAt: string;
}

export interface JobberLineItem {
  id: string;
  name: string;
  description: string | null;
  quantity: number;
  unitPrice: number;
  totalPrice: number;
}

export interface JobberJob {
  id: string;
  jobNumber: number;
  title: string;
  clientId: string;
  quoteId: string | null; // the quote this job was converted from
  instructions: string | null;
  lineItems: JobberLineItem[];
  createdAt: string;
  updatedAt: string;
}

/** "A cost estimate which service providers sent to their clients before any work is done." */
export interface JobberQuote {
  id: string;
  quoteNumber: string; // a String in Jobber's schema
  title: string;
  clientId: string;
  lineItems: JobberLineItem[];
  sentAt: string | null;
  approvedAt: string | null; // not an API field; with the jobs it became, it decides quoteStatus
  createdAt: string;
  updatedAt: string;
}

/** Each time a technician goes to the client's property to do the job's work. */
export interface JobberVisit {
  id: string;
  jobId: string;
  clientId: string;
  title: string;
  startAt: string;
  endAt: string;
  completedAt: string | null;
  assignedUserIds: string[];
  createdAt: string;
}

/** "A receipt detailing the work done as well as the cost of the service provided." */
export interface JobberInvoice {
  id: string;
  invoiceNumber: string; // a String in Jobber's schema
  subject: string;
  clientId: string;
  jobIds: string[];
  lineItems: JobberLineItem[];
  issuedDate: string;
  dueDate: string;
  paidAt: string | null; // not an API field; decides invoiceStatus and the amounts paid
  createdAt: string;
  updatedAt: string;
}

export interface JobberState {
  account: JobberAccount;
  // Maps keep insertion order, which is the order lists are served in, so pagination is stable.
  clients: Map<string, JobberClient>;
  users: Map<string, JobberUser>;
  jobs: Map<string, JobberJob>;
  visits: Map<string, JobberVisit>;
  quotes: Map<string, JobberQuote>;
  invoices: Map<string, JobberInvoice>;
}
