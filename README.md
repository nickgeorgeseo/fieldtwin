# fieldtwin

[![CI](https://github.com/nickgeorgeseo/fieldtwin/actions/workflows/ci.yml/badge.svg)](https://github.com/nickgeorgeseo/fieldtwin/actions/workflows/ci.yml)
[![License: Apache 2.0](https://img.shields.io/badge/license-Apache%202.0-blue.svg)](LICENSE)
[![Node 22+](https://img.shields.io/badge/node-22%2B-brightgreen.svg)](#quick-start)

**Jobber and QuickBooks Online, running on your laptop: real API shapes, a believable fake business, and every failure on demand. Build and test integrations and AI agents without touching a customer's account.**

Point your code at `http://localhost:4010` instead of `api.getjobber.com` or `quickbooks.api.intuit.com`. It gets the same paths, headers, and JSON back, from a fake trades business with customers, technicians, and months of jobs, quotes, invoices, and payments, kept in both systems at once. Then make it hard: throttle QuickBooks, lose the answer to a write, deliver a webhook twice, jump the clock past every token's expiry. Afterwards, see exactly what your code changed, and undo it.

```bash
curl -X POST localhost:4010/_twin/checkpoints/before-agent           # name this moment
# ...let your integration or agent loose on http://localhost:4010...
curl "localhost:4010/_twin/checkpoints/before-agent/changes?source=api"
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

fieldtwin doesn't replace the vendors' sandboxes; it covers what they can't. When you have one, its [conformance suite](conformance/README.md) records what the real API does and scores the twin against it.

## What's modeled

| | QuickBooks Online | Jobber |
|---|---|---|
| Records | Customers, items, invoices, payments | Clients, jobs, visits, quotes, invoices, users |
| Reading | By Id; the query language (`WHERE` with `=`, `<`, `>`, `LIKE`, `IN`, joined by `AND`; `ORDERBY`; paging; `COUNT(*)`); change data capture | GraphQL, with Relay pagination both ways, encoded ids, and dated API versions |
| Writing | Customers and invoices created and updated with SyncTokens (5010 when stale), sparse or full; payments created and applied; `requestid` for safe retries | `clientCreate` |
| Rate limits | 500 requests a minute per company: HTTP 429 | The query-cost budget: 10,000 points refilling 500 a second, `THROTTLED` |
| Webhooks | CloudEvents, signed, retried on Intuit's schedule | HMAC-signed, delivered at least once, retried |
| OAuth 2.0 | Authorize, tokens, refresh (rolling 100 days), revoke | Authorize with PKCE, tokens, refresh tokens that rotate |

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

Start it in a ready-made situation instead: `npm start -- flaky-apis` (see [Scenarios and faults](#scenarios-and-faults)).

## Using it with your code

Change only the base URL. Paths, headers, and body shapes match the real APIs.

| Vendor | Real base URL | Twin base URL |
|---|---|---|
| QuickBooks Online | `https://quickbooks.api.intuit.com` | `http://localhost:4010` |
| Jobber | `https://api.getjobber.com` | `http://localhost:4010` |

The QuickBooks twin serves one company, realm `9341000000000001`.

Both twins enforce the vendors' documented rate limits in twin time: Jobber answers `THROTTLED` when a query costs more than its budget has left, and QuickBooks answers HTTP 429 after 500 requests in a minute. Advancing the clock lets them recover; a reset starts them full. Faults can add more throttling on top.

### Configuration

| Variable | Default | What it does |
|---|---|---|
| `FIELDTWIN_PORT` | `4010` | The port to listen on |
| `FIELDTWIN_HOST` | `127.0.0.1` | The address to listen on. `0.0.0.0` reaches it from a container or another machine: only on a network you trust, since anyone who can reach the twin can control it ([SECURITY.md](SECURITY.md)) |
| `FIELDTWIN_AUTH` | `any-token` | `oauth` makes the vendor APIs check tokens the way the real ones do |
| `FIELDTWIN_SEED` | `42` | Which fake business to generate. The same seed always builds the same one |

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

Each vendor has a twin OAuth 2.0 server at the vendor's own paths, so your OAuth client only needs new URLs:

| Endpoint | Real URL | Twin URL |
|---|---|---|
| QuickBooks authorize | `https://appcenter.intuit.com/connect/oauth2` | `http://localhost:4010/connect/oauth2` |
| QuickBooks tokens | `https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer` | `http://localhost:4010/oauth2/v1/tokens/bearer` |
| QuickBooks revoke | `https://developer.api.intuit.com/v2/oauth2/tokens/revoke` | `http://localhost:4010/v2/oauth2/tokens/revoke` |
| Jobber authorize | `https://api.getjobber.com/api/oauth/authorize` | `http://localhost:4010/api/oauth/authorize` |
| Jobber tokens | `https://api.getjobber.com/api/oauth/token` | `http://localhost:4010/api/oauth/token` |

The twin approves every authorization request at once (there is no consent page) and accepts any `client_id` and `client_secret`. Everything after that follows the vendors' docs: codes work once, access tokens last 60 minutes, Jobber rotates refresh tokens and rejects the old one, QuickBooks keeps the refresh token on a rolling 100 days. Tokens expire on twin time, so `POST /_twin/clock/advance {"minutes": 60}` tests your refresh path in a second. (Jobber's access tokens are JWTs whose `exp` is in twin time too, so compare it with the twin's clock, not your own.)

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

Both twins send webhooks the way the vendors do. Each vendor sets them up per app in its developer portal; the twin's equivalent is the control plane (or the `twin_set_webhooks` MCP tool):

```bash
curl -X PUT localhost:4010/_twin/webhooks -H "Content-Type: application/json" -d '[
  {"vendor":"jobber","url":"http://localhost:3000/webhooks/jobber","topics":["INVOICE_UPDATE"],"clientId":"my-app","clientSecret":"dev"},
  {"vendor":"quickbooks","url":"http://localhost:3000/webhooks/qbo","topics":["qbo.payment.created.v1"],"clientId":"my-app","clientSecret":"my-verifier-token"}
]'
curl -X POST localhost:4010/_twin/actions/jobber/payInvoices -H "Content-Type: application/json" -d '2'
```

**Jobber** deliveries carry Jobber's documented payload (`{ "data": { "webHookEvent": { "topic", "appId", "accountId", "itemId", "occurredAt" } } }`) and an `X-Jobber-Hmac-SHA256` signature made with the subscription's client secret, so your verification code runs unchanged. Like Jobber, the twin delivers at least once: paying an invoice fires `INVOICE_UPDATE` twice, and a delivery your app doesn't accept within a second is sent again later in twin time. `CLIENT_CREATE` and `INVOICE_UPDATE` are modeled so far.

**QuickBooks** deliveries are CloudEvents, the format Intuit sends today: a JSON array of events like `{ "specversion": "1.0", "type": "qbo.invoice.updated.v1", "intuitentityid": "130", "intuitaccountid": "9341000000000001", ... }`, signed in `intuit-signature` with the subscription's `clientSecret` standing in for your app's verifier token. Customers, invoices, and payments created or updated through the API are announced (`qbo.customer.created.v1`, `qbo.customer.updated.v1`, `qbo.invoice.created.v1`, `qbo.invoice.updated.v1`, `qbo.payment.created.v1`), and a payment also announces each invoice it pays. Your app has 3 seconds to answer HTTP 200; otherwise the twin tries again on Intuit's schedule, from 10 seconds up to every 6 hours of twin time.

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
| `mismatched-books` | Jobber and QuickBooks disagree: customers spelled differently (same email), customers only in Jobber with unsynced work, customers only in QuickBooks |
| `flaky-apis` | Retry testing: real OAuth checks plus layered faults (QuickBooks 429s, 503s, and writes whose answer is lost; Jobber 429s, 502s, and webhooks sent twice or late) while customers keep paying |

A fault rule matches requests by vendor, method, and path, and fires at a rate:

```yaml
faults:
  - name: qbo-throttled-writes
    vendor: quickbooks
    method: POST
    rate: 0.2            # one in five matching requests
    effect: { status: 429, message: "ThrottleExceeded" }
```

Injected failures come back in the vendor's own error format and carry an `X-Twin-Fault` header, so you can tell them apart from real bugs. An `effect` can also slow a request down (`latencyMs`), or lose its answer: with `lostResponse: true` the twin does the work first and then answers with the error anyway, the way a gateway timeout hides a write that succeeded. That is the failure a retried write has to survive without happening twice (for QuickBooks, send a `requestid`):

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
```

A scenario with a typo, an unknown key, or a time without a UTC offset is refused when it loads, with the reason, and the twin stays as it was.

## The control plane

Everything under `/_twin` controls the fake world rather than imitating a vendor.

| Request | What it does |
|---|---|
| `GET /_twin` | Company, seed, loaded scenario, twin time, event count, auth mode, active faults, webhook subscriptions, checkpoints, what's scheduled next |
| `POST /_twin/reset` | Back to the start: the seeded world (the loaded scenario's, if any), with its timeline and faults |
| `POST /_twin/clock/advance` `{"minutes": 60}` | Move time forward (rate limits refill, tokens expire, scheduled events and their webhooks happen) |
| `POST /_twin/actions/:vendor/:action` (body: params) | Make something happen now, as if done in the vendor's own app: `jobber/payInvoices` with `2`, `jobber/newClients` with `3` |
| `POST /_twin/checkpoints/:name` | Name this moment |
| `GET /_twin/checkpoints/:name/changes?source=api` | What your code changed since then (or `seed`, `scenario`, `control`; everything without `source`) |
| `POST /_twin/checkpoints/:name/rewind` | Undo everything after the checkpoint. The same requests then meet the same faults |
| `PUT /_twin/faults` | Replace the active fault rules |
| `PUT /_twin/auth` `{"mode": "oauth"}` | Check bearer tokens for real (`oauth`) or accept any (`any-token`) |
| `GET /_twin/scenarios` | The ready-made scenarios and what each one tests |
| `POST /_twin/scenarios/:name` | Load a ready-made scenario |
| `POST /_twin/scenario` (YAML body) | Load your own scenario |
| `GET /_twin/log.jsonl?since=:checkpoint` | The event log, one event per line (all of it without `since`). With the seed, it is everything a bug report needs |
| `PUT /_twin/webhooks` | Replace the webhook subscriptions (see [Webhooks](#webhooks)) |
| `GET /_twin/webhooks` | The subscriptions, and each recent delivery with how your app answered |

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
| `twin_run_action` | Make something happen now: customers pay, clients call in |
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
| HTTP 401 from either vendor | The twin is checking tokens (`auth` is `oauth`, from `FIELDTWIN_AUTH`, a scenario, or `PUT /_twin/auth`). Get a token from the twin's OAuth endpoints, or switch back to `any-token` |
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
  faults/      makes vendor APIs misbehave on purpose
  control/     /_twin HTTP routes, MCP tools, scenarios (one shared operations.ts)
  app.ts       wires it together
  server.ts    entry point for `npm start`
  mcp.ts       entry point for `npm run mcp`
scenarios/     ready-made situations (heat-wave-monday, mismatched-books, flaky-apis)
examples/      code that uses the twins the way yours will: over HTTP, never importing src/
  sync-jobber-invoice-to-quickbooks/   the reference integration, its demo, and its tests
conformance/   the same scripted sessions against a real sandbox and the twin, compared and scored
test/          tests by vendor and area, plus core and the architecture guards
```

[ARCHITECTURE.md](ARCHITECTURE.md) explains how it fits together and the three rules that keep it easy to change. Read it before changing anything in `core/`.

## Contributing

Contributions are welcome, especially ones that make the twins more faithful. [CONTRIBUTING.md](CONTRIBUTING.md) walks through adding an endpoint, from the vendor's docs page to the test to the FIDELITY.md row; every vendor folder has the same shape, so once you've read one you can read them all. If you have a QuickBooks sandbox company or a Jobber testing account, the most valuable thing you can do is record the [conformance suite](conformance/README.md) against it: `npm run conformance:record` turns the twin's guesses into evidence. Build only from public documentation; never paste vendor code, private docs, or real customer data.

Where it's going: more Jobber writes as their inputs reach the public docs, recordings from real sandboxes, then more vendors (Housecall Pro, Samsara or Motive, EDI trading partners) and a benchmark for dispatch and operations agents. [ARCHITECTURE.md](ARCHITECTURE.md#roadmap) has the roadmap.

## Disclaimer and license

fieldtwin is an independent project. It is not affiliated with, endorsed by, or supported by Jobber or Intuit. Jobber and QuickBooks are trademarks of their respective owners.

Copyright 2026 Nick George. Licensed under the [Apache License 2.0](LICENSE).
