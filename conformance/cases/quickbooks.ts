import { randomUUID } from "node:crypto";
import { type Answer, type ConformanceCase, faultOf, quickbooks, quickbooksQuery, type Target, unique } from "../case.ts";

/**
 * QuickBooks Online cases, one per FIDELITY.md row the twin can't confirm from the docs alone.
 * Writes create a customer and an invoice or two in the sandbox company, under names starting "fieldtwin conformance".
 * Not here: the 429 body. Provoking a real throttle means flooding the sandbox, so record one if you meet it.
 */

const DAY = 86_400_000;

export const quickbooksCases: ConformanceCase[] = [
  // CDC first, before any case writes, so "nothing changed since now" holds.
  {
    name: "cdc-nothing-changed",
    vendor: "quickbooks",
    endpoint: "GET /cdc",
    fidelity: "CDC group with no changes",
    async observe(target) {
      const answer = await quickbooks(target, "GET", `cdc?entities=Customer&changedSince=${encodeURIComponent(await target.now())}`);
      const group = answer.body?.CDCResponse?.[0]?.QueryResponse?.[0];
      return { status: answer.status, groupKeys: group ? Object.keys(group).sort() : null };
    },
  },
  {
    name: "cdc-look-back-over-30-days",
    vendor: "quickbooks",
    endpoint: "GET /cdc",
    fidelity: "CDC look-back over 30 days",
    async observe(target) {
      const since = new Date(Date.parse(await target.now()) - 31 * DAY).toISOString();
      return faultOf(await quickbooks(target, "GET", `cdc?entities=Customer&changedSince=${encodeURIComponent(since)}`));
    },
  },
  {
    name: "read-missing-entity",
    vendor: "quickbooks",
    endpoint: "GET /customer/{id}",
    fidelity: "HTTP status of 610 on a read",
    observe: async (target) => faultOf(await quickbooks(target, "GET", "customer/987654321")),
  },
  {
    name: "unknown-access-token",
    vendor: "quickbooks",
    endpoint: "GET /query",
    fidelity: "Expired or unknown token on the API",
    observe: async (target) =>
      faultOf(
        await quickbooks(target, "GET", "query?query=SELECT%20COUNT(*)%20FROM%20Customer", undefined, { token: "fieldtwin-not-a-token" }),
      ),
  },
  {
    name: "another-company",
    vendor: "quickbooks",
    endpoint: "GET /query",
    fidelity: "Wrong realm: 403 AuthorizationFault 3100",
    observe: async (target) =>
      faultOf(await quickbooks(target, "GET", "query?query=SELECT%20COUNT(*)%20FROM%20Customer", undefined, { realmId: "1" })),
  },
  {
    name: "entity-name-case",
    vendor: "quickbooks",
    endpoint: "GET /query",
    fidelity: "Query case and escaping",
    async observe(target) {
      const answer = await quickbooksQuery(target, "select count(*) from customer");
      return { status: answer.status, totalCountIsNumber: typeof answer.body?.QueryResponse?.totalCount === "number" };
    },
  },
  {
    name: "range-operator-on-id",
    vendor: "quickbooks",
    endpoint: "GET /query",
    fidelity: "Range operators and LIKE on Id",
    observe: async (target) => faultOf(await quickbooksQuery(target, "select count(*) from Customer where Id > '0'")),
  },
  {
    name: "orderby-text-case",
    vendor: "quickbooks",
    endpoint: "GET /query",
    fidelity: "How query values compare",
    async observe(target) {
      // Every sandbox company has customers; whether their names sort without regard to case settles the row.
      const answer = await quickbooksQuery(
        target,
        "select * from Customer where DisplayName like '%' orderby DisplayName desc maxresults 50",
      );
      const names: string[] = (answer.body?.QueryResponse?.Customer ?? []).map((customer: { DisplayName: string }) => customer.DisplayName);
      const folded = names.map((name) => name.toLowerCase());
      return { status: answer.status, sortedIgnoringCase: folded.every((name, i) => i === 0 || folded[i - 1]! >= name) };
    },
  },
  {
    name: "payment-moves-invoice-synctoken",
    vendor: "quickbooks",
    endpoint: "POST /payment",
    fidelity: "Paying an invoice changes its SyncToken",
    writes: true,
    async observe(target) {
      const invoice = expectOk(await newInvoice(target), "create the invoice").Invoice;
      const payment = {
        CustomerRef: { value: invoice.CustomerRef.value },
        TotalAmt: invoice.Balance,
        Line: [{ Amount: invoice.Balance, LinkedTxn: [{ TxnId: invoice.Id, TxnType: "Invoice" }] }],
      };
      expectOk(await quickbooks(target, "POST", "payment", payment), "create the payment");
      const after = expectOk(await quickbooks(target, "GET", `invoice/${invoice.Id}`), "read the invoice").Invoice;
      return {
        syncTokenMoved: after.SyncToken !== invoice.SyncToken,
        balance: after.Balance,
        linkedTxnTypes: (after.LinkedTxn ?? []).map((link: { TxnType: string }) => link.TxnType),
      };
    },
  },
  {
    name: "inactive-customer-in-query",
    vendor: "quickbooks",
    endpoint: "GET /query",
    fidelity: "Inactive customers and items in queries",
    writes: true,
    async observe(target) {
      const DisplayName = unique("inactive customer");
      const { Id, SyncToken } = expectOk(await quickbooks(target, "POST", "customer", { DisplayName }), "create a customer").Customer;
      expectOk(await quickbooks(target, "POST", "customer", { Id, SyncToken, sparse: true, Active: false }), "make it inactive");
      const count = async (where: string) =>
        expectOk(await quickbooksQuery(target, `select count(*) from Customer where ${where}`), "count customers").QueryResponse
          ?.totalCount ?? 0;
      const byName = `DisplayName = '${DisplayName}'`;
      return { byNameOnly: await count(byName), withActiveFalse: await count(`Active = false and ${byName}`) };
    },
  },
  {
    name: "stale-synctoken",
    vendor: "quickbooks",
    endpoint: "POST /invoice",
    fidelity: "POST /invoice sparse and full update",
    writes: true,
    async observe(target) {
      const { Id, SyncToken } = expectOk(await newInvoice(target), "create the invoice").Invoice;
      expectOk(await quickbooks(target, "POST", "invoice", { Id, SyncToken, sparse: true, PrivateNote: "first" }), "update the invoice");
      return faultOf(
        await quickbooks(target, "POST", "invoice", { Id, SyncToken, sparse: true, PrivateNote: "second, with the old SyncToken" }),
      );
    },
  },
  {
    name: "duplicate-docnumber",
    vendor: "quickbooks",
    endpoint: "POST /invoice",
    fidelity: "DocNumber",
    writes: true,
    async observe(target) {
      const DocNumber = `FT-${randomUUID().slice(0, 8)}`;
      expectOk(await newInvoice(target, { DocNumber }), "create the first invoice");
      const second = await newInvoice(target, { DocNumber });
      return { secondStatus: second.status, secondCode: faultOf(second).code ?? null };
    },
  },
  {
    name: "default-due-date",
    vendor: "quickbooks",
    endpoint: "POST /invoice",
    fidelity: "DueDate default",
    writes: true,
    async observe(target) {
      const invoice = expectOk(await newInvoice(target), "create the invoice").Invoice;
      return { dueDateEqualsTxnDate: invoice.DueDate === invoice.TxnDate };
    },
  },
  {
    name: "requestid-repeat",
    vendor: "quickbooks",
    endpoint: "POST /customer?requestid",
    fidelity: "requestid on writes (idempotency)",
    writes: true,
    async observe(target) {
      const path = `customer?requestid=${randomUUID()}`;
      const body = { DisplayName: unique("requestid") };
      const first = expectOk(await quickbooks(target, "POST", path, body), "create the customer");
      const again = await quickbooks(target, "POST", path, body);
      return { secondStatus: again.status, sameCustomer: again.body?.Customer?.Id === first.Customer.Id };
    },
  },
  {
    name: "requestid-too-long",
    vendor: "quickbooks",
    endpoint: "POST /customer?requestid",
    fidelity: "requestid details the docs don't give",
    writes: true,
    observe: async (target) =>
      faultOf(await quickbooks(target, "POST", `customer?requestid=${"x".repeat(51)}`, { DisplayName: unique("long requestid") })),
  },
];

/** A new customer, and the answer to creating an invoice for them priced with the company's first Service item. */
async function newInvoice(target: Target, fields: object = {}): Promise<Answer> {
  const customer = expectOk(await quickbooks(target, "POST", "customer", { DisplayName: unique("customer") }), "create a customer");
  const items = expectOk(await quickbooksQuery(target, "SELECT * FROM Item WHERE Type = 'Service' MAXRESULTS 1"), "find a Service item");
  const item = items.QueryResponse?.Item?.[0];
  if (!item) throw new Error("The company has no Service item to put on an invoice.");
  return quickbooks(target, "POST", "invoice", {
    CustomerRef: { value: customer.Customer.Id },
    Line: [
      { DetailType: "SalesItemLineDetail", Amount: 100, SalesItemLineDetail: { ItemRef: { value: item.Id }, Qty: 1, UnitPrice: 100 } },
    ],
    ...fields,
  });
}

/** The body of a 2xx answer; anything else stops the case with what went wrong. */
function expectOk(answer: Answer, doing: string): Answer["body"] {
  if (answer.status >= 200 && answer.status < 300) return answer.body;
  throw new Error(`Couldn't ${doing}: HTTP ${answer.status} ${JSON.stringify(answer.body).slice(0, 300)}`);
}
