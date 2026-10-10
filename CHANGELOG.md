# Changelog

All notable changes to fieldtwin. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow [Semantic Versioning](https://semver.org/).

## Unreleased

### Added

- `GET /` says where everything is: the QuickBooks base URL and realm with a request to try, the Jobber endpoint and version header, how auth works right now, the control plane, and the docs. It answered "404 Not Found", which is what a browser showed anyone who opened the address the twin prints at startup.

- `GET /_twin` (and `twin_status`) shows the seed, the loaded scenario, and the checkpoints, so a run can be reproduced from its status alone. `?source=` on a change list takes any source (`seed`, `scenario`, `api`, `control`); one it doesn't know is an error instead of returning everything unfiltered.

- Reference integration: `TokenManager`'s `loadTokens` option, for processes that share one connection. Before refreshing, and once more after an `invalid_grant`, it reads the saved tokens and uses the set another process already rotated to, instead of telling the person to reconnect.

- QuickBooks queries take the rest of the documented language: `AND`, `<`, `>`, `<=`, `>=`, `LIKE` with `%`, and `ORDERBY` with `ASC`/`DESC` on several properties. `SELECT * FROM Invoice WHERE MetaData.LastUpdatedTime > '2026-07-01T00:00:00-05:00' ORDERBY TxnDate DESC` now works instead of answering "Unsupported operation". Numbers compare by value, `MetaData` times as instants, and text without regard to case.
- QuickBooks queries leave inactive customers and items out unless they filter on `Active`, as Intuit's docs imply. Code that looks a customer up before creating it now meets the inactive duplicate on the twin, as it would in production.
- `npm start -- flaky-apis` starts a ready-made scenario by name; a path to a `.yaml` (or `.yml`) file still works.

### Changed

- The README leads with what fieldtwin is for: a checkpoint, change list, and rewind in the first screen; how it compares with live accounts, vendor sandboxes, and mocks; what each twin models; a configuration table; a section on testing AI agents; and what common errors mean. Every `curl` in it now runs in the tests, in order, and the scenarios and settings it names are checked against the code.

### Fixed

- An app slow to answer webhooks no longer holds up deliveries to other URLs. Deliveries went out one at a time across every subscription, so with two apps subscribed, one that stalled delayed the other's by a second (Jobber) or three (QuickBooks) per delivery, and `POST /_twin/clock/advance` and `/_twin/actions` with them. Each URL still gets its own deliveries in order.

- In a drifted world, every customer who is only in the field-service system has at least one invoiced job, as drift promises. Across seeds, about a quarter had no invoice, so `mismatched-books` with another seed tested less than it said.

- Today's visits in the generated world start at 8:00 or later, as every other day's do. With the default 6 a.m. start, some started at 7:00, and a world starting at midnight booked visits at 2:30 a.m.

- Jobber: an id sent without its base64 padding finds the same record as the padded id. It resolved to `null`, though Jobber's own examples show ids both ways.

- QuickBooks: an invoice or payment shows its customer's current name in `CustomerRef.name` after the customer is renamed, instead of the name it had when the invoice was written.

- QuickBooks customers keep `CompanyName` (at most 100 characters, and filterable), which was silently dropped. A colon, tab, or newline in a name answers 2040, as the Customer reference's business rules say, and a DisplayName counts as taken whatever its case or surrounding spaces. FIDELITY.md now says that fields the twin doesn't model are dropped, and how its timestamps differ from QuickBooks'.

- Reference integration: the webhook handler verifies the signature over the raw bytes (decoding first changed them when a body began with a byte-order mark), answers 400 instead of throwing on a signed body that isn't JSON, and refuses bodies over 64 KiB before hashing them. A malformed URL is no longer retried eight times as if it were a network failure, and the demo accepts a `FIELDTWIN_URL` with a trailing slash.

- With `FIELDTWIN_HOST` set to a specific address, the startup line prints that address instead of a localhost URL that wouldn't work, and listening on `::1` no longer warns that others can reach the twin.

- QuickBooks defaults `TxnDate` to the company's date in its own time zone. At 8 p.m. in Texas, new invoices and payments were dated tomorrow, the UTC date.

- QuickBooks: one numeric `DocNumber` of 21 digits made every later invoice number `1e+21`, failing 2050 until a reset; numbering now counts on from ordinary numbers only. Text fields read a number as its digits and refuse objects and lists with 2010, instead of storing `{"a": 1}` as a DisplayName. An invoice with payments can't move to another customer (6000), which left payments and invoices belonging to different people. An invoice whose customer was made inactive can still be updated, and naming an inactive customer on a new invoice or payment says it is inactive.

- QuickBooks payment lines: a `LinkedTxn` without `TxnType` answers 2020 naming it, instead of "not to undefined", and a line linked to several transactions is refused instead of applied to the first with the rest ignored (even ones naming invoices that don't exist).

- Jobber `clientCreate` trims names and treats a blank `companyName` as none. A last name alone made the name " Smith", and `companyName: ""` made a company client with an empty name.

- Jobber `newClients` never runs out of names: once the word lists' names are taken, newcomers get a middle initial. A long timeline used to fail hours into twin time with "no unused names left", leaving the clock half advanced. New clients also never take the name of a customer who is only in QuickBooks, whose email address could otherwise match.

- Jobber: a query that costs more than the whole 10,000-point budget still answers `THROTTLED`, but its message now says it can never run and to ask for fewer nodes. It looked like a temporary limit, so retry loops retried it forever.

- `POST /_twin/clock/advance` counts only the scenario events it recorded. An API write that arrived while its webhooks were going out was counted too.

- Control-plane mistakes say what to send: an empty or malformed body used to answer "Unexpected end of JSON input" or "Cannot read properties of null", and an action's error suggested `{ newClients: 5 }`, which fails over HTTP. A bug in the twin behind the control plane is now a 500, logged with its stack, instead of a 400 blaming the request.

- `POST /_twin/reset` after loading a scenario restores the scenario's faults along with its world and timeline. It used to drop them, so a test harness that reset between cases lost its faults after the first. Loading a scenario without `auth` returns to the twin's own auth mode (`FIELDTWIN_AUTH`) instead of keeping the previous scenario's.

- Conformance recorder: before recording anything, it checks that each sandbox accepts its token and that its URL is right. An expired token (they last an hour) or a base URL missing `/v3` used to produce a recording of 401s or 404s that failed every case as if the twin were wrong. A Jobber testing account with no clients is no longer recorded as an observation the twin could never match.
- `npm run conformance` scores a fresh twin of its own instead of whatever twin is running, which it used to write records into and whose faults skewed the score. `FIELDTWIN_URL` still scores a running twin, and says how to start one if none answers.

- Conformance score: a recorded case the twin couldn't run now counts as nothing matched. It was left out, so one match and one crash read "4/4 observations match (100%)". Percentages round down, so nothing short of every observation reads as 100%.

- Reference integration: two syncs at once (the scheduled one and a webhook's) booked an invoice and its payment twice. Each QuickBooks write's `requestid` is now a hash of the write, so the identical write from either sync carries the same id and QuickBooks books it once.

- Reference integration: a lost connection (`OAuthError`) pauses the webhook queue instead of leaving it permanently rejected, which crashed a web server with an unhandled rejection or silently dropped every later webhook while still answering Jobber 200. What hadn't synced stays queued; `queue.connectionLost` says why, and `queue.resume()` carries on after the person reconnects.

- Reference integration: the scheduled sync reads again what changed in the ten minutes before its cutoff. With a strict `>` and no overlap, an invoice paid as a run started, or stamped by a server whose clock ran behind Jobber's, was never synced.

- Reference integration: a Jobber line whose quantity times unit price isn't its total, to the cent, is booked at its total with the pricing in its description. Sending all three made QuickBooks refuse the invoice with 6070 on every run, which also held the scheduled sync's cutoff back.

- QuickBooks paths the twin doesn't model (`/vendor/1`, `/estimate`, `/reports/...`) answer a Fault saying so, with what the twin serves, instead of a plain-text 404 an SDK can't parse.

- QuickBooks amounts: an amount sent as a numeric string (`"93.00"`, as python-quickbooks sends decimals) is accepted instead of answering "Required parameter Line.Amount is missing". Fractions of a cent, and amounts too big to add up, answer 2140 Invalid Amount; they used to be stored as sent while totals were kept in rounded cents, so lines and totals disagreed, and a 1e307 line made `TotalAmt` null. Qty × UnitPrice is checked to the cent with decimal-correct rounding, so 2.5 × 33.33 = 83.33 is no longer refused with 6070.

- A webhook delivery on its way during a reset or rewind is forgotten. If it failed, it used to be queued again, and the next clock advance sent news about an invoice the reset had erased.

- Twin time can't be pushed past what a date can hold. `POST /_twin/clock/advance {"minutes": 1e12}` used to leave the twin answering "Invalid time value" until a reset, and with a webhook retry pending it crashed the process. Advances are capped at ten years and webhook `delayMs` faults at a week. `twin_advance_clock` accepts 0, as the control plane does, to send the deliveries already due.
- Webhooks can't break anything else: a failure while queueing one no longer turns a write that succeeded into a 500, and a delivery round that fails is logged instead of failing every round after it.

- A scenario that fails to load leaves the twin as it was. A bad start time, an unreadable timeline time, or a world too big to name used to fail part way: the twin kept the new company and faults but no timeline, or emptied its log while still serving old data, and `POST /_twin/reset` failed until another scenario loaded.
- Scenario and fault-rule keys the twin doesn't know are errors. `path` instead of `pathIncludes` used to be dropped silently, so the rule faulted every request; a misspelled effect or webhook topic did nothing. A request rule with neither `status` nor `latencyMs` is refused too.
- Scenario times need a UTC offset (`2026-07-13T08:00:00-05:00` or `...Z`). Without one, a start time meant a different moment on every machine.

- Jobber connections return at most 100 nodes, as documented. `clients(first: 500)` returned every client, so code that never pages passed against the twin and would miss records in production.
- Jobber query cost: a negative `first` or `last` made the requested cost negative, which let any query past the throttle (and answered `hasNextPage: true` with no cursor). It now counts as 0. Variables' declared defaults (`$n: Int = 10`) and `@skip`/`@include` now count, so a cheap query that relies on them is no longer priced as if every page held 100 nodes and throttled forever.

- QuickBooks: `POST /customer?operation=delete` was ignored and the body applied as a full update, wiping the customer's other fields. Operations the twin doesn't model now answer "Unsupported operation" and change nothing, for every entity. `?operation=update`, which Intuit's SDKs send on every update, now works for invoices as it did for customers.
- QuickBooks: a write whose body was still uploading when its retry arrived could be made twice despite its `requestid`. The requestid is now checked after the body is read.

- A request body the twin can't use gets the vendor's own error, with a 400 that says what was wrong, instead of a plain-text 500 "Internal Server Error": malformed JSON, a body that isn't an object, QuickBooks lines that aren't objects, Jobber `variables` sent as a string, a `redirect_uri` that isn't an absolute URL, and an OAuth token request that isn't form-encoded. Anything else the twin didn't expect answers a 500 in the vendor's format and is logged with its stack, so bugs in the twin are visible.

- QuickBooks change data capture reads a `changedSince` without a UTC offset as UTC. It used the time zone of the machine running the twin, so the same request found different changes on different machines.
- Startup problems are one readable line instead of a crash: a port already in use says so and how to pick another, a scenario that can't be found lists the ones that exist, and `FIELDTWIN_PORT` or `FIELDTWIN_SEED` values that aren't numbers say what is expected. The "open for business" line now appears only once the twin is really listening.
- `npm start` and `npm run example:sync` start from any folder. From a path with a space in it, through a symlink, or on Windows, they used to exit silently without starting anything.

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
