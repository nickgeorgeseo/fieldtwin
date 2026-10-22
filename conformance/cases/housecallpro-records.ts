import { type ConformanceCase, expectOk, housecallpro } from "../case.ts";
import { errorOf, firstId, noneLike, shapeOf } from "./housecallpro-shared.ts";

/**
 * Housecall Pro cases that only read, from records the account already has: a customer with an address, a job, an
 * estimate, an invoice for a job with something still due, jobs numbered with different numbers of digits, and a job
 * with two visits. Housecall Pro's API makes no invoices, and the twin doesn't model the writes that make estimates or
 * second visits, so make these in Housecall Pro first. A case missing its records says what it needs, and isn't recorded.
 */

interface Job {
  schedule?: { scheduled_start: string; scheduled_end: string; appointments?: { start_time: string; end_time: string }[] };
}
interface Invoice {
  id: string;
  invoice_number: unknown;
  job_id?: string;
  due_amount: number;
  items?: { id: string }[];
  due_concept?: unknown;
  display_due_concept?: unknown;
}

export const housecallproRecordCases: ConformanceCase[] = [
  {
    name: "customer-not-found",
    vendor: "housecallpro",
    endpoint: "GET /customers/{id}",
    fidelity: "GET /customers and GET /customers/{id}",
    // Get Customer documents no 404 at all.
    observe: async (target) => errorOf(await housecallpro(target, "GET", `/customers/${noneLike(await firstId(target, "customers"))}`)),
  },
  {
    name: "job-not-found",
    vendor: "housecallpro",
    endpoint: "GET /jobs/{id}",
    fidelity: "GET /jobs and GET /jobs/{id}",
    // Get a Job documents its 404 as an object with no fields named; Lock Job's is { "error": { "message" } }.
    observe: async (target) => errorOf(await housecallpro(target, "GET", `/jobs/${noneLike(await firstId(target, "jobs"))}`)),
  },
  {
    name: "invoice-by-uuid",
    vendor: "housecallpro",
    endpoint: "GET /api/invoices/{uuid}",
    fidelity: "GET /api/invoices/{uuid}",
    async observe(target) {
      // "The UUID of the invoice": whether that is the id the list gives it, and what one no invoice has answers.
      // https://docs.housecallpro.com/docs/housecall-public-api/0ae16219c3e58-get-invoice-by-uuid
      const id = await firstId(target, "invoices");
      const listed = await housecallpro(target, "GET", `/api/invoices/${id}`);
      return {
        listedId: { ...errorOf(listed), withJobId: typeof listed.body?.job_id === "string" },
        unknownId: errorOf(await housecallpro(target, "GET", `/api/invoices/${noneLike(id)}`)),
      };
    },
  },
  {
    name: "estimate-not-found",
    vendor: "housecallpro",
    endpoint: "GET /estimates/{id}",
    fidelity: "GET /estimates and GET /estimates/{id}",
    observe: async (target) => errorOf(await housecallpro(target, "GET", `/estimates/${noneLike(await firstId(target, "estimates"))}`)),
  },
  {
    name: "job-for-unknown-customer",
    vendor: "housecallpro",
    endpoint: "POST /jobs",
    fidelity: "Creating a job: ids that don't exist",
    async observe(target) {
      // A customer and an address no record has, in the forms the account's own take, so nothing can be made.
      const customers = expectOk(await housecallpro(target, "GET", "/customers?page_size=10"), "list customers").customers ?? [];
      const customer = customers.find((candidate: { addresses?: { id: string }[] }) => candidate.addresses?.[0]?.id);
      if (!customer) {
        throw new Error(
          "None of the account's first customers has an address, so this case can't tell: it makes unknown ids in the form of theirs. Give a customer an address in Housecall Pro first.",
        );
      }
      const body = { customer_id: noneLike(customer.id), address_id: noneLike(customer.addresses[0].id) };
      return errorOf(await housecallpro(target, "POST", "/jobs", body));
    },
  },
  {
    name: "invoice-number-sort",
    vendor: "housecallpro",
    endpoint: "GET /jobs",
    fidelity: "Sorting lists",
    async observe(target) {
      const answer = expectOk(
        await housecallpro(target, "GET", "/jobs?sort_by=invoice_number&sort_direction=asc&page_size=100"),
        "list jobs",
      );
      const numbers: string[] = (answer.jobs ?? []).map((job: { invoice_number: unknown }) => String(job.invoice_number));
      if (!numbers.every((number) => /^\d+$/.test(number))) {
        throw new Error("Some of the account's job numbers aren't digits, so this case can't tell numbers from text.");
      }
      const inOrder = (before: (a: string, b: string) => boolean) =>
        numbers.every((number, i) => i === 0 || !before(number, numbers[i - 1]!));
      const [asNumbers, asText] = [inOrder((a, b) => Number(a) < Number(b)), inOrder((a, b) => a < b)];
      // Numbers with as many digits sort the same either way: 9 and 10 tell numbers from text, 101 and 102 can't.
      if (asNumbers && asText) {
        throw new Error(
          "The account's first jobs sort the same as numbers and as text, so this case can't tell. It needs jobs numbered with different numbers of digits, like 9 and 10.",
        );
      }
      return { sortedAs: asNumbers ? "numbers" : asText ? "text" : "neither" };
    },
  },
  {
    name: "multi-visit-schedule",
    vendor: "housecallpro",
    endpoint: "GET /jobs",
    fidelity: "Jobs with more than one visit",
    async observe(target) {
      // expand: "appointments" puts each visit in the schedule ("Only present if expanded with appointments").
      const answer = expectOk(await housecallpro(target, "GET", "/jobs?expand[]=appointments&page_size=100"), "list jobs");
      const visited: Job[] = (answer.jobs ?? []).filter((job: Job) => (job.schedule?.appointments ?? []).length > 1);
      if (!visited.length) {
        throw new Error(
          "None of the account's first 100 jobs has two or more visits, so this case can't tell how a schedule spans them. Give a job a second visit in Housecall Pro first.",
        );
      }
      const spans = visited.every(({ schedule }) => {
        const visits = schedule!.appointments!;
        const first = Math.min(...visits.map((visit) => Date.parse(visit.start_time)));
        const last = Math.max(...visits.map((visit) => Date.parse(visit.end_time)));
        return Date.parse(schedule!.scheduled_start) === first && Date.parse(schedule!.scheduled_end) === last;
      });
      return { scheduleRunsFromFirstVisitToLast: spans };
    },
  },
  {
    name: "amount-due-in-cents",
    vendor: "housecallpro",
    endpoint: "GET /invoices",
    fidelity: "amount_due_min and _max",
    async observe(target) {
      const invoices: Invoice[] = expectOk(await housecallpro(target, "GET", "/invoices?page_size=100"), "list invoices").invoices ?? [];
      const due = invoices.filter((invoice) => invoice.due_amount >= 100);
      const invoice = due.find((candidate) => candidate.due_amount % 100 === 0) ?? due[0]; // whole dollars need no decimal point
      if (!invoice) {
        throw new Error(
          "None of the account's first 100 invoices has $1 or more due, so this case can't tell cents from dollars. Leave an invoice unpaid in Housecall Pro first.",
        );
      }
      // The invoice's own amount due, as both bounds: in cents, then in dollars. Only one reading finds it.
      const finds = async (amount: number) => {
        const answer = await housecallpro(target, "GET", `/invoices?page_size=100&amount_due_min=${amount}&amount_due_max=${amount}`);
        return answer.status < 300 && (answer.body?.invoices ?? []).some((found: Invoice) => found.id === invoice.id);
      };
      const [asCents, asDollars] = [await finds(invoice.due_amount), await finds(invoice.due_amount / 100)];
      return { readAs: asCents === asDollars ? (asCents ? "ignored" : "neither") : asCents ? "cents" : "dollars" };
    },
  },
  {
    name: "invoice-number-is-job-number",
    vendor: "housecallpro",
    endpoint: "GET /invoices",
    fidelity: "Job and invoice numbers",
    async observe(target) {
      const listed: Invoice[] = expectOk(await housecallpro(target, "GET", "/invoices?page_size=5"), "list invoices").invoices ?? [];
      const invoices = listed.filter((invoice) => invoice.job_id);
      if (!invoices.length) {
        throw new Error(
          "None of the account's first invoices is for a job, so this case can't tell whether an invoice has its job's number. Invoice a job in Housecall Pro first.",
        );
      }
      let same = true;
      for (const invoice of invoices) {
        const job = expectOk(await housecallpro(target, "GET", `/jobs/${invoice.job_id}`), "read an invoice's job");
        same &&= String(job.invoice_number) === String(invoice.invoice_number);
      }
      return { everyInvoiceHasItsJobsNumber: same };
    },
  },
  {
    name: "invoice-fields",
    vendor: "housecallpro",
    endpoint: "GET /invoices",
    fidelity: "Invoice fields the docs don't explain",
    async observe(target) {
      const invoices: Invoice[] = expectOk(await housecallpro(target, "GET", "/invoices?page_size=10"), "list invoices").invoices ?? [];
      const invoice = invoices.find((candidate) => candidate.job_id && candidate.items?.length);
      if (!invoice) {
        throw new Error(
          "None of the account's first invoices is for a job and has items, so this case can't tell what its items are. Invoice a job with line items in Housecall Pro first.",
        );
      }
      const lines =
        expectOk(await housecallpro(target, "GET", `/jobs/${invoice.job_id}/line_items`), "list the job's line items").data ?? [];
      const ids = new Set(lines.map((line: { id: string }) => line.id));
      return {
        itemsAreTheJobsLineItems: invoice.items!.every((item) => ids.has(item.id)),
        dueConcept: shapeOf(invoice.due_concept),
        displayDueConcept: shapeOf(invoice.display_due_concept),
      };
    },
  },
];
