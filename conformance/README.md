# Conformance suite

The twins are built from public documentation, and the docs leave gaps. FIDELITY.md marks every behavior the twin had to guess with `check`. This suite closes those gaps with evidence: it runs the same short scripted sessions against a real vendor sandbox (for Housecall Pro, which has none, a real account) and against the twin, and compares what each one did.

```bash
npm run conformance           # score a fresh twin against the recordings (FIELDTWIN_URL scores a running one)
npm run conformance:record    # record the real sandboxes (needs your tokens and keys, below)
```

## How it works

A **case** ([`cases/`](cases/)) is a few requests against one vendor, boiled down to **observations** both systems should agree on: a status, an error code, the shape of an answer, whether a SyncToken moved. It never observes things that differ by design (Ids, times, tokens, message wording), so a twin and a sandbox full of different data can still be compared. Each case names the FIDELITY.md row it checks, and a test makes sure that row exists.

A **recording** ([`recordings/`](recordings/)) is what every case observed against a real sandbox: one JSON file per vendor, holding observations only, with no tokens, Ids, or business data.

The **test** ([`conformance.test.ts`](conformance.test.ts)) runs every case against an in-process twin. A recorded case must match its recording, or the test fails and names the observation that differs. A case nobody has recorded yet shows as a todo, so the gaps stay visible in every test run.

The **score** (`npm run conformance`) is the same comparison as a report: each case, each difference with its FIDELITY.md row, a score per endpoint, and one overall.

```text
quickbooks   read-missing-entity                1/3
                                                status: real 404, twin 400   (FIDELITY.md: HTTP status of 610 on a read)
...
By endpoint:
  quickbooks   GET /customer/{id}                 1/3 observations match (33%)

Fidelity: 41/44 observations match (93%)
```

(An illustration. Nothing has been recorded yet.)

## Recording

You need a QuickBooks Online **sandbox company**, a Jobber **developer testing account**, a Housecall Pro account on the **MAX plan**, or any of them. Never a customer's account: the cases that write create a few records named "fieldtwin conformance ...", and the recorder refuses to run against production QuickBooks.

Get an access token however you connect apps today (Intuit's OAuth 2.0 Playground works for QuickBooks; for Jobber, your app's OAuth flow against the testing account). Tokens last an hour. For Housecall Pro, use one of the account's API keys ([how to make one](https://help.housecallpro.com/en/articles/8505035-api-overview)). The recorder only reads them from your environment, and never writes them anywhere:

```bash
QBO_ACCESS_TOKEN=... QBO_REALM_ID=... \
JOBBER_ACCESS_TOKEN=... \
HOUSECALLPRO_API_KEY=... \
npm run conformance:record
```

Record a sandbox company as it was created: two cases, `duplicate-docnumber` and `default-due-date`, depend on its settings (custom transaction numbers, default sales terms) as well as on the API.

Housecall Pro has no sandbox: its API "is available to any Pro on the MAX or XL Plan" ([docs](https://docs.housecallpro.com/)), so its cases run in a real account, reached at `https://api.housecallpro.com` with `Authorization: Token <key>`. Use an account you keep for testing, never one a business runs on. The cases that write make customers and jobs named "fieldtwin conformance ..." (every job for one customer), and Housecall Pro's API can delete neither, so they stay until you delete them in Housecall Pro. None of them can be reached: phone numbers are from the 555-0100 to 555-0199 range set aside for fiction, email addresses are at example.com, notifications are off except where a case looks at their default, nobody is dispatched, and visits are in January 2020. The cases in [`cases/housecallpro-records.ts`](cases/housecallpro-records.ts) read records the account must already have, so make these in Housecall Pro first: a customer with an address, a job, an estimate, an unpaid invoice for a job with line items, jobs numbered with different numbers of digits (9 and 10, say), and a job with two visits. A case missing its records says what it needs, and isn't recorded.

Leave out a vendor's variables to record only the others. `QBO_API_BASE` (default `https://sandbox-quickbooks.api.intuit.com/v3`), `JOBBER_API_URL`, and `HOUSECALLPRO_API_URL` (default `https://api.housecallpro.com`) override the endpoints. `npm run conformance:record -- --dry-run` prints what it would save instead of saving it; the cases still run, so the ones that write still create their test records. Before recording anything, the recorder checks that each token and key is accepted, so an expired one can't produce a recording of 401s. An answer that says nothing about the API (a 429, a 502 to 504, Jobber's `THROTTLED`, or a 401 once a token expires or a key stops working part way) is never recorded: that case keeps what it observed last time, and the recorder exits with an error so you know to run it again.

Then run `npm test`. Every case that doesn't match is a failing test, which leaves two honest choices:

1. **Fix the twin** to do what the real API did, and turn the FIDELITY.md row's `check` into the recording's date.
2. If the twin can't match yet, keep the failing case out of `recordings/` and say why in the FIDELITY.md row.

Commit the recordings. They are the evidence behind the `Verified` column.

## What's covered

QuickBooks: CDC with nothing changed and with a look-back over 30 days, the status of 610 on a read, a body that isn't JSON, an unknown token (and the casing of its fault), another company's realm, entity names in lower case, a range operator on Id, an unquoted negative number, whether ORDERBY sorts text without regard to case, whether queries leave inactive customers out, whether paying an invoice moves its SyncToken, a stale SyncToken, duplicate DocNumbers, the default DueDate, and `requestid` replays, reuse on another endpoint, and length.

Jobber: a missing and an unknown version header, an unknown token, a syntax error, a body that isn't JSON, variables sent as a string, the padding of encoded ids, the cost of `{ account { id name } }` and of connection extras, whether the root `invoices` and `users` queries exist, and `clientCreate` with only a company name.

Housecall Pro: no credentials and an unknown access token, a body that isn't JSON, `X-Company-Id` and `location_ids` naming a location the key can't reach, a `page` and `page_size` of 0 and a `page_size` of 1000, `sort_by` an attribute customers don't have; ids no customer, job, invoice, or estimate has, and a job for a customer that doesn't exist; whether jobs sort by `invoice_number` as numbers, how a two-visit job's schedule spans its visits, whether `amount_due_min` and `_max` are cents, and whether an invoice has its job's number and line items; a customer without a name, with fields of the wrong kind, and with only a name, a phone number, and an address (the defaults), what a `PUT` keeps and clears, an address without a street, what `q` matches, and how customers sort by last name and by default; and, for jobs, line item defaults, the line items list, no address, a number another job has, a schedule without an end, times without an offset, `work_status` for a job never scheduled and one long past, the `work_status` filter, and a customer's notes on a job.

Not covered: QuickBooks' 429 body, and Housecall Pro's 429 with its `RateLimit-Reset` (provoking a real throttle means flooding the sandbox or account; if you meet one, add it by hand). Housecall Pro's webhook payloads, signatures, and delivery (Housecall Pro sends them to a public URL set in the account, and the recorder has none for them to reach), its OAuth token lifetimes, refresh token rotation, and token requests as forms (OAuth apps are for integration partners, and an API key never meets them), `work_timestamps` and option approval (they follow what a Pro and their customer do in the app), and payments (the twin's describe the world's history, not the API).

## Adding a case

Add it to [`cases/quickbooks.ts`](cases/quickbooks.ts) (or [`cases/quickbooks-writes.ts`](cases/quickbooks-writes.ts) if it creates records), [`cases/jobber.ts`](cases/jobber.ts), or [`cases/housecallpro.ts`](cases/housecallpro.ts) (or the file beside it for one that reads the account's records, makes customers, or makes jobs), with the FIDELITY.md row it checks. Observe as little as settles the question, and nothing that varies between runs or accounts. Never name an observation `error`: that is how a run marks a case that couldn't finish. Mark it `writes: true` if it creates anything. Like `examples/`, this folder reaches the twin over HTTP only and never imports `src/` (its test may, to run a twin in process).
