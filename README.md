# fieldtwin

[![CI](https://github.com/nickgeorgeseo/fieldtwin/actions/workflows/ci.yml/badge.svg)](https://github.com/nickgeorgeseo/fieldtwin/actions/workflows/ci.yml)
[![License: Apache 2.0](https://img.shields.io/badge/license-Apache%202.0-blue.svg)](LICENSE)
[![Node 22+](https://img.shields.io/badge/node-22%2B-brightgreen.svg)](#quick-start)

**Jobber and QuickBooks Online, running on your laptop: real API shapes, a believable fake business, and every failure on demand. Build and test integrations and AI agents without touching a customer's account.**

[Watch the two-minute demo](https://nickgeorgeai.com/fieldtwin#demo): the dashboard drives a twin, an agent's changes are listed and rewound, and a sync brings drifted books back into line.

Point your code at `http://localhost:4010` instead of `api.getjobber.com` or `quickbooks.api.intuit.com` (or at `http://localhost:4010/housecallpro` instead of `api.housecallpro.com`). It gets the same paths, headers, and JSON back, from a fake trades business with customers, technicians, and months of jobs, quotes, invoices, and payments, kept in both systems at once. Then make it hard: throttle QuickBooks, lose the answer to a write, deliver a webhook twice, jump the clock past every token's expiry. Afterwards, see exactly what your code changed, and undo it.

```bash
curl -X POST localhost:4010/_twin/checkpoints/before-agent           # name this moment
# ...let your integration or agent loose on http://localhost:4010...
curl -s "localhost:4010/_twin/checkpoints/before-agent/changes?source=api" | jq -r '.[].summary'
```

```text
2026-07-13T11:00:00.000Z  quickbooks  CustomerCreated Id=26 "Dana Whitfield" SyncToken=0  (api)
2026-07-13T11:00:00.000Z  quickbooks  InvoiceCreated Id=29 DocNumber=1001 "Dana Whitfield" TotalAmt=185.00 Balance=185.00  (api)
2026-07-13T11:00:00.000Z  quickbooks  CustomerUpdated Id=3 "Harper Alder Jr" SyncToken=1  (api)
```

```bash
curl -X POST localhost:4010/_twin/checkpoints/before-agent/rewind    # and it never happened
```

Every run starts from a seed, so the same requests give the same results, byte for byte. A bug you hit once, you can hit again.

## Why fieldtwin

If you build software for field-service and trades businesses, you know the options. Test against a client's live books and hope. Wait for vendor sandbox access, then fill an empty account by hand. Or write mocks that return exactly what you expected, and so never catch what you didn't. None of these suits an AI agent, which needs somewhere it can make mistakes many times over, in parallel.

| | A client's live account | Vendor sandbox | Hand-written mocks | **fieldtwin** |
|---|---|---|---|---|
| Safe to break | No | Yes | Yes | **Yes** |
| Ready to use | When the client trusts you | After a developer account, an app, and setup | After you write each endpoint | **`npm start`** |
| Realistic data | Yes | Generic samples, or none | What you typed | **A seeded business with months of history** |
| Jobber and QuickBooks describe the same business | Yes | No | No | **Yes, or drifted on purpose** |
| Back to a clean start | Never | By hand | Restart | **`POST /_twin/reset`** |
| 429s, 5xx, lost answers, duplicate webhooks on demand | No | No | Only the ones you thought of | **Yes, in the vendor's own error format** |
| Skip ahead in time (token expiry, retries, scheduled events) | No | No | Rarely | **Yes, instantly** |
| See what your code changed, and undo it | No | No | No | **Checkpoints, change lists, rewind** |
| Offline, in CI, many copies in parallel | No | No | Yes | **Yes** |
| Exactly like production | Yes | Nearly | No | **No. Modeled from the public docs, and [FIDELITY.md](FIDELITY.md) says how closely** |

fieldtwin doesn't replace the vendors' sandboxes; it covers what they can't, and a final check in one before you go live is still worth doing. When you have a sandbox, fieldtwin's [conformance suite](conformance/README.md) records what the real API does and scores the twin against it.

## Who it's for

**Developers building integrations for trades and field-service software.** The bugs that cost you are the ones you can't make happen on purpose: a throttled API, a write whose answer never came back, a webhook that arrives twice, a token that expires halfway through a sync. fieldtwin makes them happen whenever you ask, in a business that looks real in both systems, and twin time skips the waiting. The [reference integration](#a-worked-example-jobber-to-quickbooks) gets through more than a hundred retries and two hours of token expiry in a couple of seconds. Every run starts from a seed, so a failure replays exactly, in CI or on a teammate's laptop. You ship sooner, and you find the bad night in testing instead of in a customer's books.

**Teams building AI agents that touch a business's money.** An agent needs somewhere to make mistakes, many times over, and you need proof of what it actually did. Mark a checkpoint, let the agent work, and judge it on the exact list of changes it made, not on what it says it did. Then rewind and run it again. Load `mismatched-books` to see whether it notices the two systems disagree, or `flaky-apis` to see whether it gives up. The [dashboard](#the-dashboard) shows all of it as it happens.

**Agencies and integrators who sell to trades businesses.** "We test against a full simulation of your Jobber and QuickBooks before anything touches your account" is a promise you can keep, and a reason a cautious owner says yes.

**The businesses themselves**, though they never run it. They get syncs that don't create duplicate customers, leave invoices out of the books, or record a payment twice, and AI assistants that made their mistakes in a copy of the business instead of in theirs.

### What you get

| You get | Instead of |
|---|---|
| A working fake business, in Jobber and QuickBooks at once, from one command | Developer accounts, app setup, and test data typed in by hand |
| Throttling, outages, lost answers, and duplicate webhooks whenever you ask | Meeting them for the first time in production |
| Hours of retry waits and token expiry, in seconds | Tests that sleep, or that never cover it |
| The same results from the same seed, every run | "Works on my machine" |
| An exact list of what your code or agent changed, and an undo | Guessing from logs, on an account you can never reset |
| [Tests that run on every commit](#testing-on-every-commit), offline, with no vendor account | Checking by hand in a sandbox before each release |

fieldtwin is built by Nick George. Its page, with both demo videos, is at [nickgeorgeai.com/fieldtwin](https://nickgeorgeai.com/fieldtwin); more of his work, and how to reach him, at [nickgeorgeai.com](https://nickgeorgeai.com).

## What's modeled

| | QuickBooks Online | Jobber | Housecall Pro |
|---|---|---|---|
| Records | Customers, items, invoices, payments | Clients, jobs, visits, quotes, invoices, users | Customers and their addresses, employees, jobs with appointments and line items, estimates, invoices |
| Reading | By Id; the query language (`WHERE` with `=`, `<`, `>`, `LIKE`, `IN`, joined by `AND`; `ORDERBY`; paging; `COUNT(*)`); change data capture | GraphQL, with Relay pagination both ways, encoded ids, and dated API versions | REST lists with `page` and `page_size`, sorting, customer search, and the documented job and invoice filters |
| Writing | Customers and invoices created and updated with SyncTokens (5010 when stale), sparse or full; payments created and applied; `requestid` for safe retries | `clientCreate` | Customers created and updated, addresses added; jobs created, scheduled, and dispatched |
| Rate limits | 500 requests a minute per company: HTTP 429 | The query-cost budget: 10,000 points refilling 500 a second, `THROTTLED` | Not published: fault rules make 429s, with `RateLimit-Reset` |
| Webhooks | CloudEvents, signed, retried on Intuit's schedule | HMAC-signed, delivered at least once, retried | The whole record, signed with `Api-Timestamp` and `Api-Signature`, tried once |
| OAuth 2.0 | Authorize, tokens, refresh (rolling 100 days), revoke | Authorize with PKCE, tokens, refresh tokens that rotate | Authorize, tokens (30 days), refresh tokens that rotate; API keys as `Authorization: Token` |

Anything not listed fails clearly in the vendor's own error format rather than returning made-up data. [FIDELITY.md](FIDELITY.md) has every behavior, how closely it matches, and the docs page it comes from.

## Quick start

Requires Node 22+.

```bash
git clone https://github.com/nickgeorgeseo/fieldtwin && cd fieldtwin
npm ci
npm start
```

```text
fieldtwin: Rowntree Electric is open for business at http://localhost:4010
fieldtwin: auth is any-token: ANY Bearer token is accepted. Set FIELDTWIN_AUTH=oauth for real OAuth checks.
```

Open http://localhost:4010 in a browser for where everything is. Read a customer from the QuickBooks twin (by default any bearer token works; see [Authentication](#authentication)):

```bash
curl -H "Authorization: Bearer dev" \
  http://localhost:4010/v3/company/9341000000000001/customer/1
```

List clients from the Jobber twin:

```bash
curl -X POST http://localhost:4010/api/graphql \
  -H "Authorization: Bearer dev" \
  -H "X-JOBBER-GRAPHQL-VERSION: 2025-04-16" \
  -H "Content-Type: application/json" \
  -d '{"query":"{ clients(first: 5) { nodes { id name } totalCount } }"}'
```

List scheduled jobs from the Housecall Pro twin, with an API key (any key works):

```bash
curl -H "Authorization: Token dev" \
  "http://localhost:4010/housecallpro/jobs?work_status[]=scheduled&page_size=5"
```

Start it in a ready-made situation instead: `npm start -- flaky-apis` (see [Scenarios and faults](#scenarios-and-faults)).

## Using it with your code

Change only the base URL. Paths, headers, and body shapes match the real APIs.

| Vendor | Real base URL | Twin base URL |
|---|---|---|
| QuickBooks Online | `https://quickbooks.api.intuit.com` | `http://localhost:4010` |
| Jobber | `https://api.getjobber.com` | `http://localhost:4010` |
| Housecall Pro | `https://api.housecallpro.com` | `http://localhost:4010/housecallpro` |

The QuickBooks twin serves one company, realm `9341000000000001`. The Housecall Pro twin serves the real paths under `/housecallpro`, because some of them (`/api/invoices/{uuid}`) start the way Jobber's do.

The QuickBooks and Jobber twins enforce the vendors' documented rate limits in twin time: Jobber answers `THROTTLED` when a query costs more than its budget has left, and QuickBooks answers HTTP 429 after 500 requests in a minute. Advancing the clock lets them recover; a reset starts them full. Housecall Pro doesn't publish its limits, so its twin throttles only when a fault rule says so. Faults can add more throttling on top of any of them.

### Configuration

| Variable | Default | What it does |
|---|---|---|
| `FIELDTWIN_PORT` | `4010` | The port to listen on |
| `FIELDTWIN_HOST` | `127.0.0.1` | The address to listen on. `0.0.0.0` reaches it from a container or another machine: only on a network you trust, since anyone who can reach the twin can control it ([SECURITY.md](SECURITY.md)) |
| `FIELDTWIN_AUTH` | `any-token` | `oauth` makes the vendor APIs check tokens the way the real ones do |
| `FIELDTWIN_SEED` | `42` | Which fake business to generate. The same seed always builds the same one |

## Testing on every commit

Your tests reach the twin the way your app does. Each test loads a fresh world, runs your code against it, and checks the change list: what your code really did, not what it logged. Twin time skips the waiting, so retries and token expiry take seconds, and every world comes from a seed, so a test that fails in CI fails the same way on your laptop.

**1. Write a test.** This one checks for the bug a lost answer causes. QuickBooks can accept two invoices with the same number, so code that retries a create after a timeout, without a `requestid`, books the same work twice:

```ts
// test/sync.test.ts in your project. Run it with a twin at FIELDTWIN_URL (npm start in the fieldtwin folder).
import assert from "node:assert/strict";
import { beforeEach, test } from "node:test";
import { syncPaidInvoices } from "../src/sync.ts"; // your code

const TWIN = process.env.FIELDTWIN_URL ?? "http://localhost:4010";

/** Something the twin recorded: what changed, in which vendor, with the whole record as that vendor's API returns it. */
interface Change {
  vendor: string;
  type: string;
  data: any;
}

/** A request to the twin's control plane, failing the test with the twin's reason if it refuses. */
async function twin(method: string, path: string) {
  const response = await fetch(`${TWIN}/_twin${path}`, { method });
  if (!response.ok) throw new Error(`${method} /_twin${path}: ${await response.text()}`);
  return response.json();
}

beforeEach(async () => {
  await twin("POST", "/scenarios/flaky-apis"); // a fresh world for each test: 429s, 503s, and writes whose answer is lost
  await twin("POST", "/checkpoints/before-sync");
});

test("books each invoice once, even when QuickBooks loses the answer to a write", async () => {
  await syncPaidInvoices({ jobberUrl: TWIN, quickbooksUrl: TWIN });

  const changes: Change[] = await twin("GET", "/checkpoints/before-sync/changes?source=api"); // what your code did
  const booked = changes
    .filter((change) => change.vendor === "quickbooks" && change.type === "InvoiceCreated")
    .map((change) => change.data.invoice.DocNumber);

  assert.ok(booked.length > 0, "the sync booked no invoices");
  assert.equal(new Set(booked).size, booked.length, `an invoice was booked twice: ${booked.join(", ")}`);
});
```

It uses Node's built-in test runner; Vitest and Jest work the same way. Against a sync that retries without a `requestid`, it fails with the duplicate it found:

```text
✖ books each invoice once, even when QuickBooks loses the answer to a write
  AssertionError [ERR_ASSERTION]: an invoice was booked twice: 41, 41
```

**2. Run it locally.**

```bash
npm start                                         # in the fieldtwin folder
FIELDTWIN_URL=http://localhost:4010 npm test      # in your project
```

**3. Run it on every commit.** In GitHub Actions, check out fieldtwin beside your code, start it, and wait until it answers:

```yaml
# .github/workflows/test.yml in your project
name: Tests
on: [push, pull_request]

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v7
      - uses: actions/checkout@v7
        with:
          repository: nickgeorgeseo/fieldtwin
          path: fieldtwin # pin `ref:` to a release tag, like v0.4.0, for repeatable runs
      - uses: actions/setup-node@v7
        with:
          node-version: 22
      - name: Start the twin
        working-directory: fieldtwin
        run: |
          npm ci
          nohup npm start > twin.log 2>&1 &
          timeout 60 bash -c 'until curl -sf localhost:4010/_twin > /dev/null; do sleep 1; done'
      - run: npm ci && npm test
        env:
          FIELDTWIN_URL: http://localhost:4010
      - name: Keep the twin's event log
        if: failure()
        run: curl -s localhost:4010/_twin/log.jsonl > fieldtwin/log.jsonl
      - if: failure()
        uses: actions/upload-artifact@v7
        with:
          name: fieldtwin-log
          path: fieldtwin/log.jsonl
```

When a run fails, its event log is kept with it: everything your code did to the twin, to read or to replay.

A few things to know:

- **Tests that share a twin share its world.** Run the files that use it one at a time (`node --test --test-concurrency=1`, Vitest's `--no-file-parallelism`, Jest's `--runInBand`), or start a twin for each worker on its own `FIELDTWIN_PORT`.
- **`flaky-apis` checks OAuth tokens for real**, so your code connects through the twin's [OAuth endpoints](#authentication), as it will in production. To test retries alone, follow the scenario with `PUT /_twin/auth` and `{"mode": "any-token"}`.
- **For a stronger check**, the reference integration's [flaky test](examples/sync-jobber-invoice-to-quickbooks/test/sync-flaky.test.ts) syncs through `flaky-apis` and checks the books end exactly as a clean run leaves them.

## A worked example: Jobber to QuickBooks

[`examples/sync-jobber-invoice-to-quickbooks`](examples/sync-jobber-invoice-to-quickbooks) is a reference integration written like production code, and you're welcome to copy it. It books every paid Jobber invoice into QuickBooks (customer, invoice, payment), on a schedule and from Jobber's webhooks as customers pay. It handles everything the twins throw at it: 429s and 5xx with backoff, answers lost after a write, Jobber's query-cost throttle, expiring and rotating OAuth tokens, stale SyncTokens, customers spelled differently in each system, webhooks that come twice or late, and two syncs at once.

```bash
npm start                  # terminal 1
npm run example:sync       # terminal 2
```

Its tests show what testing against a twin buys you: the same sync under `flaky-apis` settles to exactly the books a clean run produces, through more than a hundred retries, and the two hours it waits for its tokens to expire take no real time.

## Testing an AI agent

The twin gives an agent a whole business to work in and you a precise record of what it did. Give each test a checkpoint, let the agent work, then judge it on the change list rather than on what it says it did:

```bash
curl -X POST localhost:4010/_twin/checkpoints/before-agent
# ...run your agent against the twin...
curl "localhost:4010/_twin/checkpoints/before-agent/changes?source=api"
curl -X POST localhost:4010/_twin/checkpoints/before-agent/rewind
```

Load `flaky-apis` to see how it copes when the APIs fight back, or `mismatched-books` to see whether it notices that the two systems disagree. To let a coding agent drive the twin itself, use the [MCP server](#using-it-from-a-coding-agent-mcp).

## Authentication

> **By default the twin accepts any bearer token.** That keeps the quick start to one command, and it is the
> wrong setting for testing your OAuth code. To make the twin check tokens the way the real APIs do, start it
> with `FIELDTWIN_AUTH=oauth npm start`, put `auth: oauth` in a scenario, or switch a running twin:
> `curl -X PUT localhost:4010/_twin/auth -H "Content-Type: application/json" -d '{"mode":"oauth"}'`.

Each vendor has a twin OAuth 2.0 server at the vendor's own paths (under `/housecallpro` for Housecall Pro), so your OAuth client only needs new URLs:

| Endpoint | Real URL | Twin URL |
|---|---|---|
| QuickBooks authorize | `https://appcenter.intuit.com/connect/oauth2` | `http://localhost:4010/connect/oauth2` |
| QuickBooks tokens | `https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer` | `http://localhost:4010/oauth2/v1/tokens/bearer` |
| QuickBooks revoke | `https://developer.api.intuit.com/v2/oauth2/tokens/revoke` | `http://localhost:4010/v2/oauth2/tokens/revoke` |
| Jobber authorize | `https://api.getjobber.com/api/oauth/authorize` | `http://localhost:4010/api/oauth/authorize` |
| Jobber tokens | `https://api.getjobber.com/api/oauth/token` | `http://localhost:4010/api/oauth/token` |
| Housecall Pro authorize | `https://pro.housecallpro.com/oauth/authorize` | `http://localhost:4010/housecallpro/oauth/authorize` |
| Housecall Pro tokens | `https://api.housecallpro.com/oauth/token` | `http://localhost:4010/housecallpro/oauth/token` |

The twin approves every authorization request at once (there is no consent page) and accepts any `client_id` and `client_secret`. Everything after that follows the vendors' docs: codes work once, access tokens last 60 minutes (30 days for Housecall Pro), Jobber and Housecall Pro rotate refresh tokens and reject the old one, QuickBooks keeps the refresh token on a rolling 100 days. Tokens expire on twin time, so `POST /_twin/clock/advance {"minutes": 60}` tests your refresh path in a second. (Jobber's access tokens are JWTs whose `exp` is in twin time too, so compare it with the twin's clock, not your own.)

A Pro's own Housecall Pro integration uses an API key instead, sent as `Authorization: Token <key>`. The twin can't know which keys a Pro made, so it takes any key, in either auth mode.

Getting a Jobber token from the command line:

```bash
CODE=$(curl -s -o /dev/null -w '%{redirect_url}' \
  "http://localhost:4010/api/oauth/authorize?response_type=code&client_id=my-app&redirect_uri=http://localhost:3000/callback" \
  | sed -E 's/.*code=([^&]+).*/\1/')
curl -s -X POST http://localhost:4010/api/oauth/token \
  -d client_id=my-app -d client_secret=dev -d grant_type=authorization_code \
  -d code=$CODE -d redirect_uri=http://localhost:3000/callback
```

## Webhooks

Every twin sends webhooks the way its vendor does. Each vendor sets them up per app (in a developer portal, or in a Pro's own settings for Housecall Pro); the twin's equivalent is the control plane (or the `twin_set_webhooks` MCP tool):

```bash
curl -X PUT localhost:4010/_twin/webhooks -H "Content-Type: application/json" -d '[
  {"vendor":"jobber","url":"http://localhost:3000/webhooks/jobber","topics":["INVOICE_UPDATE"],"clientId":"my-app","clientSecret":"dev"},
  {"vendor":"quickbooks","url":"http://localhost:3000/webhooks/qbo","topics":["qbo.payment.created.v1"],"clientId":"my-app","clientSecret":"my-verifier-token"},
  {"vendor":"housecallpro","url":"http://localhost:3000/webhooks/hcp","topics":["invoice.paid"],"clientId":"my-app","clientSecret":"my-signing-secret"}
]'
curl -X POST localhost:4010/_twin/actions/jobber/payInvoices -H "Content-Type: application/json" -d '2'
curl -X POST localhost:4010/_twin/actions/housecallpro/payInvoices -H "Content-Type: application/json" -d '2'
```

**Jobber** deliveries carry Jobber's documented payload (`{ "data": { "webHookEvent": { "topic", "appId", "accountId", "itemId", "occurredAt" } } }`) and an `X-Jobber-Hmac-SHA256` signature made with the subscription's client secret, so your verification code runs unchanged. Like Jobber, the twin delivers at least once: paying an invoice fires `INVOICE_UPDATE` twice, and a delivery your app doesn't accept within a second is sent again later in twin time. `CLIENT_CREATE` and `INVOICE_UPDATE` are modeled so far.

**QuickBooks** deliveries are CloudEvents, the format Intuit sends today: a JSON array of events like `{ "specversion": "1.0", "type": "qbo.invoice.updated.v1", "intuitentityid": "130", "intuitaccountid": "9341000000000001", ... }`, signed in `intuit-signature` with the subscription's `clientSecret` standing in for your app's verifier token. Customers, invoices, and payments created or updated through the API are announced (`qbo.customer.created.v1`, `qbo.customer.updated.v1`, `qbo.invoice.created.v1`, `qbo.invoice.updated.v1`, `qbo.payment.created.v1`), and a payment also announces each invoice it pays. Your app has 3 seconds to answer HTTP 200; otherwise the twin tries again on Intuit's schedule, from 10 seconds up to every 6 hours of twin time.

**Housecall Pro** deliveries carry the documented shared fields (`event`, `company_id`, `event_occurred_at`, `event_created_at`) and the whole record, as the event left it: `{ "event": "job.created", ..., "job": { ... } }`. `Api-Timestamp` and `Api-Signature` follow the docs' verification steps, an HMAC-SHA256 of the timestamp, a dot, and the payload, keyed with the subscription's `clientSecret` as your signing secret. `customer.created`, `customer.updated`, `job.created`, `job.scheduled`, `job.completed`, `job.paid`, `invoice.created`, `invoice.sent`, `invoice.payment.succeeded`, and `invoice.paid` are modeled so far. Jobs get finished, invoiced, and paid by the `completeJobs`, `invoiceJobs`, and `payInvoices` actions, in a scenario's timeline or through the control plane: invoicing a job sends `invoice.created` and then `invoice.sent`, and paying an invoice sends `invoice.payment.succeeded`, `invoice.paid`, and `job.paid`, in that order. The docs promise no retries, so the twin tries each delivery once.

Each URL gets its deliveries one at a time, in order; an app that is slow to answer doesn't hold up deliveries to another. `GET /_twin/webhooks` shows every recent delivery and how your app answered it.

Fault rules with a `webhook` topic (`INVOICE_UPDATE`, `qbo.invoice.updated.v1`, or `"*"`) make deliveries misbehave instead of requests: sent twice, or late enough that later ones overtake them. Faulted deliveries carry `X-Twin-Fault`.

```yaml
faults:
  - name: jobber-webhooks-twice
    vendor: jobber
    webhook: INVOICE_UPDATE
    rate: 0.3
    effect: { duplicate: true }
  - name: jobber-webhooks-late
    vendor: jobber
    webhook: "*"
    rate: 0.2
    effect: { delayMs: 300000 }   # five minutes of twin time late
```

## Scenarios and faults

A scenario is a YAML file: seed, start time, world size, faults, and what happens as time passes. Start the twin with a ready-made one by name, or with your own file:

```bash
npm start -- heat-wave-monday
npm start -- my-scenario.yaml
```

| Scenario | What it tests |
|---|---|
| `heat-wave-monday` | A busy HVAC Monday: 120 customers, throttled QuickBooks writes, a slow Jobber, and new clients calling in all morning |
| `mismatched-books` | The field-service systems (Jobber and Housecall Pro) and QuickBooks disagree: customers spelled differently (same email), customers only in the field with unsynced work, customers only in QuickBooks, and a customer QuickBooks has as inactive who has paid for new work since |
| `flaky-apis` | Retry testing: real OAuth checks plus layered faults (QuickBooks 429s, 503s, and writes whose answer is lost; Jobber 429s, 502s, and webhooks sent twice or late; Housecall Pro 429s with `RateLimit-Reset`, 502s, writes whose answer is lost, and webhooks sent late) while customers keep paying |

A fault rule matches requests by vendor, method, and path (`pathIncludes`, and `pathExcludes` to leave some alone, like a vendor's OAuth endpoints), and fires at a rate:

```yaml
faults:
  - name: qbo-throttled-writes
    vendor: quickbooks
    method: POST
    rate: 0.2            # one in five matching requests
    effect: { status: 429, message: "ThrottleExceeded" }
```

Injected failures come back in the vendor's own error format, with the headers it sends (a Housecall Pro 429 has `RateLimit-Reset`, in twin time), and carry an `X-Twin-Fault` header, so you can tell them apart from real bugs. An `effect` can also slow a request down (`latencyMs`), or lose its answer: with `lostResponse: true` the twin does the work first and then answers with the error anyway, the way a gateway timeout hides a write that succeeded. That is the failure a retried write has to survive without happening twice (for QuickBooks, send a `requestid`):

```yaml
  - name: qbo-lost-answers
    vendor: quickbooks
    method: POST
    rate: 0.1
    effect: { status: 504, lostResponse: true }
```

A scenario can also schedule what happens as twin time passes. Advancing the clock runs each entry at its own time, recorded with source `scenario`:

```yaml
timeline:
  - at: "08:00"                  # business time; also "+90m", "+2h", or "2026-07-13T15:00:00Z"
    jobber: { newClients: 12 }   # new clients call in
  - at: "13:00"
    jobber: { payInvoices: 4 }   # the longest-open invoices get paid
  - at: "16:00"
    housecallpro: { completeJobs: 2, invoiceJobs: 2, payInvoices: 1 }   # techs finish work, the Pro invoices it, a customer pays
```

Housecall Pro has `newCustomers` too, like Jobber's `newClients`. A job is finished only once all of its visits have begun, so `completeJobs` never marks work done before its time. Finishing a job doesn't invoice it: `invoiceJobs` invoices finished work, the work finished longest ago first, and from then on `payInvoices` can pay it.

A scenario with a typo, an unknown key, or a time without a UTC offset is refused when it loads, with the reason, and the twin stays as it was.

## The control plane

Everything under `/_twin` controls the fake world rather than imitating a vendor.

| Request | What it does |
|---|---|
| `GET /_twin` | Company, seed, loaded scenario, twin time, event count, auth mode, active faults, webhook subscriptions, checkpoints, what's scheduled next |
| `POST /_twin/reset` | Back to the start: the seeded world (the loaded scenario's, if any), with its timeline and faults |
| `POST /_twin/clock/advance` `{"minutes": 60}` | Move time forward (rate limits refill, tokens expire, scheduled events and their webhooks happen) |
| `POST /_twin/actions/:vendor/:action` (body: params) | Make something happen now, as if done in the vendor's own app: `jobber/payInvoices` with `2`, `jobber/newClients` with `3`, `housecallpro/invoiceJobs` with `1` |
| `POST /_twin/checkpoints/:name` | Name this moment |
| `GET /_twin/checkpoints/:name/changes?source=api` | What your code changed since then (or `seed`, `scenario`, `control`; everything without `source`): each event, with a one-line `summary`. Like the log, it takes `after=` to read on from an earlier read |
| `POST /_twin/checkpoints/:name/rewind` | Undo everything after the checkpoint. The same requests then meet the same faults |
| `PUT /_twin/faults` | Replace the active fault rules |
| `PUT /_twin/auth` `{"mode": "oauth"}` | Check bearer tokens for real (`oauth`) or accept any (`any-token`) |
| `GET /_twin/scenarios` | The ready-made scenarios and what each one tests |
| `POST /_twin/scenarios/:name` | Load a ready-made scenario |
| `POST /_twin/scenario` (YAML body) | Load your own scenario |
| `GET /_twin/log.jsonl?since=:checkpoint` | The event log, one event per line (all of it without `since`). With the seed, it is everything a bug report needs. Its `X-Twin-Log-Position` header says where the log ends |
| `GET /_twin/log.jsonl?after=:position` | Only what was recorded after a position an earlier read gave (or after an event's `seq`): how to follow the log as it grows. A 409 means the log has changed in between (a reset, a rewind, a scenario, or a restarted twin): read it again from the start |
| `PUT /_twin/webhooks` | Replace the webhook subscriptions (see [Webhooks](#webhooks)) |
| `GET /_twin/webhooks` | The subscriptions, and each recent delivery with how your app answered |

## The dashboard

[`dashboard/`](dashboard/README.md) is a web dashboard for a running twin: everything in the control plane from a browser, the event log as it grows, and QuickBooks side by side with Jobber or Housecall Pro, every customer and invoice marked as matching or drifted.

```bash
npm start                                   # terminal 1: the twin
cd dashboard && npm ci && npm run dev       # terminal 2: http://localhost:4020
```

It is a Next.js package of its own and a client of the twin like any other: it uses only `/_twin`, so watching your code spends no rate limit and draws no fault.

## Using it from a coding agent (MCP)

`npm run mcp` starts the twin and an MCP server over stdio. Its tools mirror the control plane:

| Tool | What it does |
|---|---|
| `twin_status` | Company, seed, scenario, twin time, auth mode, active faults, checkpoints, what's scheduled next |
| `twin_reset` | Back to the start of the loaded scenario (or the default world) |
| `twin_advance_clock` | Move time forward; scheduled scenario events happen on the way |
| `twin_checkpoint`, `twin_changes`, `twin_rewind` | Mark a moment, list what changed since (optionally only your API calls), undo it |
| `twin_list_scenarios`, `twin_load_scenario` | Pick a ready-made scenario by name, or load your own YAML |
| `twin_set_faults` | Make the APIs misbehave on purpose |
| `twin_set_auth` | Accept any token, or check OAuth tokens for real |
| `twin_export_log` | The event log as JSON Lines, all of it or since a checkpoint |
| `twin_run_action` | Make something happen now: customers pay, clients call in, techs finish jobs, finished work is invoiced |
| `twin_set_webhooks`, `twin_webhooks` | Subscribe your app to webhooks; see what was delivered and how it answered |

Claude Code:

```bash
claude mcp add fieldtwin -- npx tsx /path/to/fieldtwin/src/mcp.ts
```

The MCP tools only control the test world. Your agent still calls the vendor APIs over HTTP, the same way production code will.

## When something looks wrong

| You see | What it means |
|---|---|
| `fieldtwin: port 4010 is already in use` | Another twin (or something else) has the port. `FIELDTWIN_PORT=4011 npm start` |
| HTTP 401 from any vendor | The twin is checking tokens (`auth` is `oauth`, from `FIELDTWIN_AUTH`, a scenario, or `PUT /_twin/auth`). Get a token from the twin's OAuth endpoints, or switch back to `any-token`. Housecall Pro also answers 401 for an `Authorization` header not written exactly `Token <key>` or `Bearer <token>` |
| Jobber `THROTTLED` on every try | The query asks for more than the whole 10,000-point budget, so it can never run. Ask for fewer nodes with `first` or `last` |
| QuickBooks 5010 `Stale Object` | Your update sent an old `SyncToken`, as the real API would refuse too. Read the record again and retry |
| An `X-Twin-Fault` header | A fault rule fired, on purpose. `GET /_twin` lists the active ones |
| A 500 that mentions a bug in fieldtwin | Please [open an issue](https://github.com/nickgeorgeseo/fieldtwin/issues) with the twin's log and `GET /_twin/log.jsonl` |

## Project layout

```text
src/
  core/        the twin runtime: event log, clock, seeded randomness, OAuth server, vendor contract
  world/       the vendor-neutral fake business: customers, price list, months of work history, drift
  vendors/
    quickbooks/  one folder per vendor, all with the same shape
    jobber/
    housecallpro/
  faults/      makes vendor APIs misbehave on purpose
  control/     /_twin HTTP routes, MCP tools, scenarios (one shared operations.ts)
  app.ts       wires it together
  server.ts    entry point for `npm start`
  mcp.ts       entry point for `npm run mcp`
scenarios/     ready-made situations (heat-wave-monday, mismatched-books, flaky-apis)
examples/      code that uses the twins the way yours will: over HTTP, never importing src/
  sync-jobber-invoice-to-quickbooks/   the reference integration, its demo, and its tests
conformance/   the same scripted sessions against a real sandbox and the twin, compared and scored
dashboard/     a web dashboard for a running twin (Next.js, a package of its own), over HTTP like examples/
test/          tests by vendor and area, plus core and the architecture guards
```

[ARCHITECTURE.md](ARCHITECTURE.md) explains how it fits together and the three rules that keep it easy to change. Read it before changing anything in `core/`.

## Contributing

Contributions are welcome, especially ones that make the twins more faithful. [CONTRIBUTING.md](CONTRIBUTING.md) walks through adding an endpoint, from the vendor's docs page to the test to the FIDELITY.md row; every vendor folder has the same shape, so once you've read one you can read them all. If you have a QuickBooks sandbox company, a Jobber testing account, or a Housecall Pro account on the MAX or XL plan that you keep for testing, the most valuable thing you can do is record the [conformance suite](conformance/README.md) against it: `npm run conformance:record` turns the twin's guesses into evidence. Check first that the vendor's API terms allow it ([links to each](conformance/README.md#recording)). Build only from public documentation; never paste vendor code, private docs, or real customer data.

Where it's going: more Jobber writes as their inputs reach the public docs, recordings from real sandboxes, more of Housecall Pro, then more vendors (Samsara or Motive, EDI trading partners) and a benchmark for dispatch and operations agents. [ARCHITECTURE.md](ARCHITECTURE.md#roadmap) has the roadmap.

## Disclaimer and license

fieldtwin is an independent project. It is not affiliated with, endorsed by, or supported by Jobber, Intuit, or Housecall Pro. Jobber, QuickBooks, and Housecall Pro are trademarks of their respective owners.

Copyright 2026 [Nick George](https://nickgeorgeai.com). Licensed under the [Apache License 2.0](LICENSE).
