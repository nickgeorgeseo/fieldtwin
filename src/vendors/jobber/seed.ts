import { multiplyMoney } from "../../core/money.ts";
import type { NewEvent } from "../../core/types.ts";
import type { World } from "../../world/generate-world.ts";
import type { WorldLineItem } from "../../world/history.ts";
import { encodeId } from "./encoded-id.ts";
import type { JobberClient, JobberInvoice, JobberJob, JobberLineItem, JobberQuote, JobberUser, JobberVisit } from "./types.ts";

const SEED_TIME = "2020-01-01T00:00:00.000Z";

/** Turns the shared world into Jobber's starting records: the account, clients, users, and work history. */
export function seedJobber(world: World): NewEvent[] {
  const ids = new WorldIds(world);
  const events: NewEvent[] = [
    {
      vendor: "jobber",
      type: "AccountCreated",
      data: { account: { id: encodeId("Account", 1), name: world.company.name, utcOffsetHours: world.company.utcOffsetHours } },
    },
  ];
  const record = (type: string, data: object) => events.push({ vendor: "jobber", type, data });

  // Jobber is the field-service system: customers who exist only in the books aren't here (see world/drift.ts).
  world.customers.forEach((person, index) => {
    if (world.drift.accountingOnly.includes(person.key)) return;
    const client: JobberClient = {
      id: encodeId("Client", index + 1),
      firstName: person.firstName,
      lastName: person.lastName,
      companyName: null,
      emails: [{ address: person.email, primary: true }],
      phones: [{ number: person.phone, primary: true }],
      createdAt: SEED_TIME,
    };
    record("ClientCreated", { client });
  });

  for (const tech of world.technicians) {
    const user: JobberUser = {
      id: ids.user(tech.key),
      name: { first: tech.firstName, last: tech.lastName, full: `${tech.firstName} ${tech.lastName}` },
      email: { raw: tech.email },
      isAccountOwner: false,
      createdAt: SEED_TIME,
    };
    record("UserCreated", { user });
  }

  for (const worldQuote of world.history.quotes) {
    const quote: JobberQuote = {
      id: ids.quote(worldQuote.key),
      quoteNumber: String(worldQuote.number),
      title: worldQuote.title,
      clientId: ids.client(worldQuote.customerKey),
      lineItems: lineItems(worldQuote.lineItems, ids, "QuoteLineItem"),
      sentAt: worldQuote.sentAt,
      approvedAt: worldQuote.approvedAt ?? null,
      createdAt: worldQuote.createdAt,
      updatedAt: worldQuote.approvedAt ?? worldQuote.sentAt,
    };
    record("QuoteCreated", { quote });
  }

  for (const worldJob of world.history.jobs) {
    const job: JobberJob = {
      id: ids.job(worldJob.key),
      jobNumber: worldJob.number,
      title: worldJob.title,
      clientId: ids.client(worldJob.customerKey),
      quoteId: worldJob.quoteKey ? ids.quote(worldJob.quoteKey) : null,
      instructions: null,
      lineItems: lineItems(worldJob.lineItems, ids, "JobLineItem"),
      createdAt: worldJob.createdAt,
      updatedAt: worldJob.visits.at(-1)?.completedAt ?? worldJob.createdAt,
    };
    record("JobCreated", { job });

    for (const worldVisit of worldJob.visits) {
      const visit: JobberVisit = {
        id: ids.visit(worldVisit.key),
        jobId: job.id,
        clientId: job.clientId,
        title: job.title,
        startAt: worldVisit.startAt,
        endAt: worldVisit.endAt,
        completedAt: worldVisit.completedAt ?? null,
        assignedUserIds: worldVisit.technicianKeys.map((key) => ids.user(key)),
        createdAt: worldJob.createdAt,
      };
      record("VisitCreated", { visit });
    }
  }

  for (const worldInvoice of world.history.invoices) {
    const invoice: JobberInvoice = {
      id: ids.invoice(worldInvoice.key),
      invoiceNumber: String(worldInvoice.number),
      subject: world.history.jobs.find((job) => job.key === worldInvoice.jobKey)!.title,
      clientId: ids.client(worldInvoice.customerKey),
      jobIds: [ids.job(worldInvoice.jobKey)],
      lineItems: lineItems(worldInvoice.lineItems, ids, "InvoiceLineItem"),
      issuedDate: worldInvoice.issuedAt,
      dueDate: worldInvoice.dueAt,
      paidAt: worldInvoice.paidAt ?? null,
      createdAt: worldInvoice.createdAt,
      updatedAt: worldInvoice.paidAt ?? worldInvoice.issuedAt,
    };
    record("InvoiceCreated", { invoice });
  }

  return events;
}

function lineItems(lines: WorldLineItem[], ids: WorldIds, type: string): JobberLineItem[] {
  return lines.map((line) => ({
    id: ids.next(type),
    name: line.name,
    description: line.description,
    quantity: line.quantity,
    unitPrice: line.unitPrice,
    totalPrice: multiplyMoney(line.quantity, line.unitPrice),
  }));
}

/** Jobber ids for world records: the world's keys ("cust-007", "job-0012") map to encoded ids. */
class WorldIds {
  private counters = new Map<string, number>();
  private customerIndex: Map<string, number>;
  private technicianIndex: Map<string, number>;

  constructor(world: World) {
    this.customerIndex = new Map(world.customers.map((customer, index) => [customer.key, index + 1]));
    this.technicianIndex = new Map(world.technicians.map((tech, index) => [tech.key, index + 1]));
  }

  client(key: string): string {
    return encodeId("Client", this.customerIndex.get(key)!);
  }

  user(key: string): string {
    return encodeId("User", this.technicianIndex.get(key)!);
  }

  job(key: string): string {
    return encodeId("Job", numberIn(key));
  }

  visit(key: string): string {
    return encodeId("Visit", numberIn(key));
  }

  quote(key: string): string {
    return encodeId("Quote", numberIn(key));
  }

  invoice(key: string): string {
    return encodeId("Invoice", numberIn(key));
  }

  next(type: string): string {
    const n = (this.counters.get(type) ?? 0) + 1;
    this.counters.set(type, n);
    return encodeId(type, n);
  }
}

/** "job-0012" -> 12 */
function numberIn(key: string): number {
  return Number(key.slice(key.lastIndexOf("-") + 1));
}
