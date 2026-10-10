# Conformance suite

The twins are built from public documentation, and the docs leave gaps. FIDELITY.md marks every behavior the twin had to guess with `check`. This suite closes those gaps with evidence: it runs the same short scripted sessions against a real vendor sandbox and against the twin, and compares what each one did.

```bash
npm run conformance           # score a fresh twin against the recordings (FIELDTWIN_URL scores a running one)
npm run conformance:record    # record the real sandboxes (needs your tokens, below)
```

## How it works

A **case** ([`cases/`](cases/)) is a few requests against one vendor, boiled down to **observations** both systems should agree on: a status, an error code, the shape of an answer, whether a SyncToken moved. It never observes things that differ by design (Ids, times, tokens, message wording), so a twin and a sandbox full of different data can still be compared. Each case names the FIDELITY.md row it checks, and a test makes sure that row exists.

A **recording** ([`recordings/`](recordings/)) is what every case observed against a real sandbox: one JSON file per vendor, holding observations only, with no tokens, Ids, or business data.

The **test** ([`conformance.test.ts`](conformance.test.ts)) runs every case against an in-process twin. A recorded case must match its recording, or the test fails and names the observation that differs. A case nobody has recorded yet shows as a todo, so the gaps stay visible in every test run.

The **score** (`npm run conformance`) is the same comparison as a report: each case, each difference with its FIDELITY.md row, a score per endpoint, and one overall.

```text
quickbooks read-missing-entity                1/3
                                              status: real 404, twin 400   (FIDELITY.md: HTTP status of 610 on a read)
...
By endpoint:
  GET /customer/{id}                 1/3 observations match (33%)

Fidelity: 41/44 observations match (93%)
```

(An illustration. Nothing has been recorded yet.)

## Recording

You need a QuickBooks Online **sandbox company**, a Jobber **developer testing account**, or both. Never a customer's account: the cases that write create a few records named "fieldtwin conformance ...", and the recorder refuses to run against production QuickBooks.

Get an access token however you connect apps today (Intuit's OAuth 2.0 Playground works for QuickBooks; for Jobber, your app's OAuth flow against the testing account). Tokens last an hour, and the recorder only reads them from your environment:

```bash
QBO_ACCESS_TOKEN=... QBO_REALM_ID=... \
JOBBER_ACCESS_TOKEN=... \
npm run conformance:record
```

Leave out a vendor's variables to record only the other one. `QBO_API_BASE` (default `https://sandbox-quickbooks.api.intuit.com/v3`) and `JOBBER_API_URL` override the endpoints. `npm run conformance:record -- --dry-run` prints what it would save instead of saving it; the cases still run, so the ones that write still create their test records. Before recording anything, the recorder checks that each token is accepted, so an expired one can't produce a recording of 401s.

Then run `npm test`. Every case that doesn't match is a failing test, which leaves two honest choices:

1. **Fix the twin** to do what the real API did, and turn the FIDELITY.md row's `check` into the recording's date.
2. If the twin can't match yet, keep the failing case out of `recordings/` and say why in the FIDELITY.md row.

Commit the recordings. They are the evidence behind the `Verified` column.

## What's covered

QuickBooks: CDC with nothing changed and with a look-back over 30 days, the status of 610 on a read, a body that isn't JSON, an unknown token (and the casing of its fault), another company's realm, entity names in lower case, a range operator on Id, whether ORDERBY sorts text without regard to case, whether queries leave inactive customers out, whether paying an invoice moves its SyncToken, a stale SyncToken, duplicate DocNumbers, the default DueDate, and `requestid` replays and length.

Jobber: a missing and an unknown version header, an unknown token, a syntax error, a body that isn't JSON, variables sent as a string, the padding of encoded ids, the cost of `{ account { id name } }` and of connection extras, whether the root `invoices` and `users` queries exist, and `clientCreate` with only a company name.

Not covered: QuickBooks' 429 body (provoking a real throttle means flooding the sandbox; if you meet one, add it by hand).

## Adding a case

Add it to [`cases/quickbooks.ts`](cases/quickbooks.ts) or [`cases/jobber.ts`](cases/jobber.ts) with the FIDELITY.md row it checks. Observe as little as settles the question, and nothing that varies between runs or accounts. Mark it `writes: true` if it creates anything. Like `examples/`, this folder reaches the twin over HTTP only and never imports `src/` (its test may, to run a twin in process).
