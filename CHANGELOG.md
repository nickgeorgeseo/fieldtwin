# Changelog

All notable changes to fieldtwin. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow [Semantic Versioning](https://semver.org/).

## Unreleased

### Added

- QuickBooks queries take the rest of the documented language: `AND`, `<`, `>`, `<=`, `>=`, `LIKE` with `%`, and `ORDERBY` with `ASC`/`DESC` on several properties. `SELECT * FROM Invoice WHERE MetaData.LastUpdatedTime > '2026-07-01T00:00:00-05:00' ORDERBY TxnDate DESC` now works instead of answering "Unsupported operation". Numbers compare by value, `MetaData` times as instants, and text without regard to case.
- QuickBooks queries leave inactive customers and items out unless they filter on `Active`, as Intuit's docs imply. Code that looks a customer up before creating it now meets the inactive duplicate on the twin, as it would in production.
- `npm start -- flaky-apis` starts a ready-made scenario by name; a path to a `.yaml` (or `.yml`) file still works.

### Fixed

- QuickBooks change data capture reads a `changedSince` without a UTC offset as UTC. It used the time zone of the machine running the twin, so the same request found different changes on different machines.
- Startup problems are one readable line instead of a crash: a port already in use says so and how to pick another, a scenario that can't be found lists the ones that exist, and `FIELDTWIN_PORT` or `FIELDTWIN_SEED` values that aren't numbers say what is expected. The "open for business" line now appears only once the twin is really listening.
- `npm start` and `npm run example:sync` start from any folder. From a path with a space in it, or on Windows, they used to exit silently without starting anything.

## 0.2.1 - 2026-10-09

Ready to be public: the twin listens on this machine only unless you open it up, there is a policy for reporting vulnerabilities privately, and npm won't publish the package by accident.

### Changed

- `package.json` is marked `private`, so `npm publish` refuses it. fieldtwin runs from a clone (`npm start` uses `tsx`, a dev dependency) and isn't packaged for npm yet.

### Security

- The twin listens on 127.0.0.1 by default instead of every network interface. It accepts any token by default, its control plane has no auth, and a webhook subscription makes it POST to any URL, so on a shared network anyone could control it or use it to reach addresses inside yours. `FIELDTWIN_HOST` (`0.0.0.0` in a container) opens it up again, with a warning at startup.
- `SECURITY.md`: how to use the twin safely, and how to report a vulnerability privately.

## 0.2.0 - 2026-10-09

The twins start talking back: webhooks from both vendors, signed and retried the way each one does it, with faults that deliver them twice or late. QuickBooks writes become safe to retry with `requestid`, and a new fault loses answers after the work is done to prove it. QuickBooks enforces its own rate limit, Jobber pages backwards, the reference integration reacts to webhooks, and a conformance suite stands ready to turn the twins' guesses into evidence against real sandboxes.

### Added

- Jobber connections page backwards too: `last` and `before` on every connection, nested ones included. Jobber's docs name `last` and say paging is "based on the Relay framework"; the page and `pageInfo` follow the Relay connection spec's algorithm.
- QuickBooks' documented rate limit: 500 requests per minute per company, every app together, counted over a sliding minute of twin time. The 501st answers HTTP 429 (`ThrottleExceeded`) and nothing more gets through until 60 seconds after the burst, so waiting the documented 60 seconds is exactly enough and retrying sooner isn't. The 10-requests-per-second limit stays a fault rule, since twin time stands still between requests. `SlidingWindowLimit` (in `core/`) is the new kind of limit behind it.
- QuickBooks webhooks: customers, invoices, and payments created or updated through the API are announced in Intuit's CloudEvents format (a JSON array of events with `type` like `qbo.invoice.updated.v1`, which is also what a subscription names), signed in `intuit-signature` with the subscription's `clientSecret` standing in for the app's verifier token. A payment also announces each invoice it pays. Apps have 3 seconds to answer HTTP 200; other answers are retried on Intuit's documented schedule (10s, 20s, 30s, 5m, 20m, 2h, 4h, then every 6h) in twin time. Each vendor now sets its own delivery policy (`VendorWebhooks.delivery`), and every notification gets a number that is never reused, so vendors can give each event an id that its redeliveries keep.
- The sync example reacts to Jobber's webhooks: `jobberWebhookHandler` verifies the signature and answers at once, and an `InvoiceQueue` syncs each invoice a webhook names (`syncPaidInvoice`), folding repeats together. The demo has a third run that receives real webhooks over HTTP; `flaky-apis` sends Jobber webhooks twice and late.
- Jobber webhooks (roadmap v0.2): `CLIENT_CREATE` and `INVOICE_UPDATE` in the documented payload, signed with `X-Jobber-Hmac-SHA256`, sent to the subscriptions set with `PUT /_twin/webhooks` (or the `twin_set_webhooks` MCP tool) after the request or clock advance that caused them. Paying an invoice fires `INVOICE_UPDATE` twice, a second apart, as documented; a delivery the app doesn't accept within a second is retried on twin time; `GET /_twin/webhooks` shows each delivery and how the app answered. Subscriptions survive reset and rewind; nothing is sent for the seeded world or rebuilt history. `VendorTwin` gains an optional `webhooks`.
- Webhook delivery faults: a fault rule with `webhook: TOPIC` (or `"*"`) and `effect: { duplicate: true }` or `{ delayMs }` sends deliveries twice, or late enough that later ones overtake them, marked with `X-Twin-Fault`.
- `POST /_twin/actions/:vendor/:action` and the `twin_run_action` MCP tool make a vendor's scenario action happen now (`jobber/payInvoices`, `jobber/newClients`), recorded with source `control`.
- A `lostResponse` fault effect: the twin does the work, then answers with the rule's error anyway, the way a gateway timeout hides a write that succeeded. It is the failure that makes a retried write happen twice unless it is idempotent.
- The conformance suite (`conformance/`, roadmap v0.3): 22 cases for the QuickBooks and Jobber behaviors FIDELITY.md marks `check`, run against an in-process twin by `npm test`. `npm run conformance:record` records them against a QuickBooks sandbox company and a Jobber testing account using your tokens (and refuses production QuickBooks); recorded cases must then match, and `npm run conformance` scores a running twin per case, per endpoint, and overall. Nothing is recorded yet, so the cases show as todos.
- QuickBooks honors `requestid` on customer, invoice, and payment writes, as documented: a repeated request gets the first answer again, word for word, and writes nothing. The answer travels on the write's event, so rewinding forgets it along with the write.

### Changed

- `twin.rateLimitBucket(key, limits)` is now `twin.rateLimit(key, create)`, so each vendor keeps the kind of limit its docs describe: Jobber a `LeakyBucket`, QuickBooks a `SlidingWindowLimit`.
- Advancing the clock (`POST /_twin/clock/advance`, the MCP tool, `advanceClock()`) now resolves once the webhooks it caused have been delivered, so `advanceClock()` returns a promise.
- `flaky-apis` also loses the answer to 15% of QuickBooks writes after making them (504), so retry logic has to be idempotent to pass it. The sync example sends a `requestid` with every write and settles to a clean run's books; its tests show a client without one making eight copies of an invoice.

## 0.1.0 - 2026-10-09

The twins grow from customers and clients into the money: QuickBooks invoices, payments, items, queries, and change data capture; Jobber jobs, visits, quotes, and invoices with a history behind them; real OAuth on both; scenarios that play out over twin time; and a reference integration that syncs one into the other.

### Added

- `examples/sync-jobber-invoice-to-quickbooks`: a reference integration that books paid Jobber invoices into QuickBooks (customer, invoice, payment, stamp), written like production code: retries with backoff and `Retry-After`, QuickBooks' 60-second throttle wait, Jobber's exact `THROTTLED` wait, a `requestid` on every QuickBooks write, single-flight token refresh that keeps rotated refresh tokens, stale-SyncToken recovery, customer matching by email, and full idempotency. Its tests run it against in-process twins, including `flaky-apis` and `mismatched-books`. `npm run example:sync` runs the demo against a running twin.
- MCP tools `twin_list_scenarios`, `twin_load_scenario`, `twin_set_faults`, `twin_set_auth`, and `twin_export_log`, with matching control-plane routes (`GET /_twin/scenarios`, `POST /_twin/scenarios/:name`, `GET /_twin/log.jsonl?since=`).
- The `flaky-apis` scenario for retry testing: real OAuth checks and layered faults on both vendors.
- World drift and the `mismatched-books` scenario: customers spelled differently in QuickBooks (same email), customers only in Jobber with work QuickBooks has never seen, and customers only in QuickBooks.
- Scenario timelines: schedule vendor actions (`jobber: { newClients: 15 }`, `jobber: { payInvoices: 3 }`) at business times, offsets, or exact times. Advancing the clock runs them in order, recorded with source `scenario`; rewinding re-arms them. `GET /_twin` shows what's coming next.
- Twin OAuth 2.0 servers for QuickBooks and Jobber at the vendors' own paths: authorization, token exchange, refresh (Jobber rotates, QuickBooks rolls), PKCE, revocation, and expiry on twin time. An auth mode (`FIELDTWIN_AUTH=oauth`, `auth: oauth` in a scenario, or `PUT /_twin/auth`) makes the APIs reject unknown and expired tokens; the default still accepts any token, and the README says so up front.
- Jobber `clientCreate`, matching the docs' sample mutation and its `userErrors` contract.
- QuickBooks starts with the books a bookkeeper two weeks behind would have: older invoices (numbered as in Jobber) and the payments against them. The last two weeks are deliberately missing, so there is real sync work to do from the first request.
- Jobber invoices (`invoices`, `invoice`, `Client.invoices`, `Job.invoices`), paid, open, or past due, with `amounts`, `Client.balance`, and `Job.invoicedTotal`. An invoice turns `past_due` on its own as twin time passes its due date.
- Jobber quotes (`quotes`, `quote`, `Client.quotes`, `Job.quote`), converted or awaiting a response.
- Jobber jobs, visits, and users from the world's history: `jobs`, `job`, `Client.jobs`, `Job.visits`, `Visit.assignedUsers`, `users`. `jobStatus` and `visitStatus` are derived from the twin clock, so a visit moves from upcoming to today to late as time passes. Every list is a full Relay connection with `edges`.
- World history, deterministic from the seed: about three months of completed jobs and visits across the technicians, quotes for bigger work, invoices (most paid, some open, a few past due), today's schedule, and the next two weeks. Vendor-neutral facts that each vendor turns into its own records.
- QuickBooks change data capture (`GET /cdc`) and a much fuller query language: `SELECT COUNT(*)`, `WHERE Id IN (...)`, filters on references like `CustomerRef`, queries over Item, Invoice, and Payment, and `POST /query`.
- QuickBooks payments: create and read. Lines apply amounts to invoices; paid invoices read `Balance: 0` and link the payment; the rest is `UnappliedAmt`.
- QuickBooks invoices: create, read, and sparse and full update (SyncToken rules, line Ids kept, totals recomputed), with Item lines, computed `TotalAmt` and `Balance`, the subtotal line QuickBooks appends, automatic `DocNumber`s, and the documented line validation errors (2020, 2050, 2290, 2500, 6070).
- QuickBooks Items, seeded from the world's new trade-specific price list (`world.catalog`): `GET /item/{id}`. QuickBooks entities now carry `domain` and `sparse` like the documented samples.
- `LICENSE` (Apache-2.0), `CONTRIBUTING.md` with the "adding an endpoint" workflow, and this changelog.
- Biome for linting and formatting (`npm run lint`, `npm run format`), and a GitHub Actions workflow running typecheck, lint, and tests on Node 22.
- Architecture guard tests: `test/determinism.test.ts` fails on wall-clock or unseeded-random APIs in `src/`, and `test/import-boundaries.test.ts` enforces the layer rules in ARCHITECTURE.md.
- `VendorTwin.describeEvent()`: each vendor explains its own events in one line, including Ids and SyncTokens.
- Jobber accepts every active API version from the changelog (2022-05-23 through 2026-09-25) and resolves historic versions to the oldest active one.
- Jobber rejects variables that are not EncodedIds with the documented error shape.
- Jobber `actualQueryCost`, counted over the data that came back and charged to the bucket.
- An MCP test that drives the tools through a real MCP client.

### Changed

- Jobber connections treat `after: null` as the first page, the way Relay clients ask for it. It used to fail the whole query.
- Every fault rule that matches a request gets its own chance to fire (it used to be only the first), so rules can be layered.
- QuickBooks query values match without regard to case and accept `\'` escapes, as documented. Features the twin doesn't model answer 500 `Unsupported operation` instead of a parse error.
- QuickBooks error bodies now use the documented messages (610, 2020, 4000, 4001, 5010, 6240) and carry the `element` field. A request for another company answers 403 `AuthorizationFault` 3100 instead of 3200.
- Jobber query cost follows the documented formula exactly (every field 1 point; `edges`, `nodes`, `node`, and connections free; per-node fields multiplied by `first`, `last`, or 100).
- Jobber answers syntax and validation errors with HTTP 200 and an `errors` list, as documented, instead of 400.
- Jobber cost budgets are kept per access token instead of one per twin, and reset and rewind start them full.
- Fault rules are validated wherever they come from, and their HTTP status is typed as an error status (no more `as 400`).
- The MCP entry point moved from `src/control/mcp.ts` to `src/mcp.ts`. Update `claude mcp add` commands accordingly.
- vitest upgraded to 4.1.11 to clear npm audit advisories.

## 0.0.1 - 2026-10-09

### Added

- First sketch: QuickBooks Online customers and Jobber clients, the event log with checkpoints and rewind, seeded world generation, fault injection, scenarios, the `/_twin` control plane, and an MCP server.
