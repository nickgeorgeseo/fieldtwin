# Changelog

All notable changes to fieldtwin. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow [Semantic Versioning](https://semver.org/).

## Unreleased

### Added

- A typed client for the control plane. `startTwin()` now answers one, with `checkpoint()`, `changes()`, `rewind()`, `loadScenario()`, `advance({ hours: 2 })`, `runAction()`, `log()`, `setFaults()`, `setAuth()`, `setWebhooks()`, and the rest beside `url`, `port`, and `close()`, so a test no longer writes its own fetch helper; `connectTwin(url)` makes the same client for a twin started some other way, and `fieldtwin/client` has it alone, with no Node.js imports. A refusal throws a `TwinError` with the twin's reason and HTTP status.
- `changes()` and `log()` are typed: narrow a change by `vendor` and `type` (or ask `changes()` for only those) and its `data` is that vendor's record, named as its docs name it, like `data.invoice.DocNumber`. The package exports the control plane's answers as types too: `TwinStatus`, `Change`, `TwinLogEvent`, `Scenario`, `FaultRule`, `WebhookSubscription`, and the rest.
- `connect(vendor)` connects an app through the twin's OAuth server as a person approving it would, and answers its tokens (and QuickBooks' `realmId`), for tests whose code takes tokens rather than getting them, in `flaky-apis` or any twin checking OAuth for real.
- A scenario can be an object: `startTwin({ scenario: { seed: 7, faults: [...] } })` and `loadScenario(object)`, typed as `Scenario`, so a test needs no YAML file.
- `GET /_twin/vendors` names each vendor the twin serves, where its API lives, the actions `POST /_twin/actions` takes, and the webhook topics it sends, so tools needn't hard-code them.

### Fixed

- A `LIKE` pattern in a QuickBooks query is matched part by part instead of as a backtracking regular expression. A few `%` wildcards used to hold up every API and the control plane for seconds or longer, since the twin runs on one thread, and a pattern over 32,767 characters answered 500 SystemFault. Now both answer at once.
- An unquoted number in a QuickBooks query keeps the digits it was written with, so `DocNumber = 007` finds invoice `007`, not invoice `7`, and `DocNumber = 100.50` or a DocNumber of 16 or more digits finds its invoice instead of nothing. `TotalAmt` and `Balance` still compare numbers by value.
- `true` and `false` in a QuickBooks query match no text and no Id, as the twin promised. A customer named `False` used to answer `DisplayName = false`, and an invoice numbered `TRUE` answered `DocNumber = true`.
- A QuickBooks query that quotes its syntax, like `select '*' from Customer` or `Id 'in' '(' '1' ')'`, answers 4000. The twin used to run it and answer records, though a quoted string is only ever a value.
- `startTwin({ hostname: "" })` is refused. It used to listen on every address, the opposite of the loopback-only default, and answer the unusable URL `http://:PORT`.
- A `FIELDTWIN_PORT` over 65,535 or a `FIELDTWIN_SEED` too large to be exact is refused by name, like a value that isn't a number, instead of failing later with a message that didn't say which setting was wrong.
- A QuickBooks update that sends `"SyncToken": null` gets 2020 naming SyncToken, as one left out does. Before, it got 5010 Stale Object, so a client that re-reads and retries on 5010 kept retrying against a record nobody had changed.
- A QuickBooks customer whose DisplayName is only spaces gets 2020, since names match without their surrounding spaces and that is the empty name. Before, it was stored, and afterwards `"  "` was refused as a duplicate of it.
- A QuickBooks customer, invoice, or payment sent with a top-level property named `Fault` is written, with Fault dropped like any field the twin doesn't model. Before, the request body came back word for word as a 400 that wasn't a QuickBooks Fault, and nothing was written.
- A QuickBooks customer's `Active` must be true or false: anything else, such as `"false"` or `0`, gets 2010 naming Active, and null counts as not sent. Before, the value was stored as sent. With null, the customer vanished from every query, even `WHERE Active IN (true, false)`. With `"false"`, payments treated the customer as active while queries left it out as inactive.
- A number sent for a QuickBooks text field keeps every digit sent, even past what JavaScript holds exactly. Before, a 22-digit DocNumber was stored as `"1e+21"` and got past the 21-character limit, and `12345678901234567890` was stored as `12345678901234567000`.
- A QuickBooks customer's `PrimaryPhone.FreeFormNumber` and `PrimaryEmailAddr.Address` are read as text: a number as its digits, so the 30-character phone limit still holds, and an object or list gets 2010 naming the field. Before, either was stored as sent and its length went unchecked.
- An invoice update that sends one existing line twice, as a client that clones a line it read does, gives the second copy a new Id. Before, both lines kept the same Id, so a later update naming that line was ambiguous.
- Automatic invoice numbers keep counting past 15 digits. Before, after an invoice numbered 999999999999999 every automatic DocNumber was 1000000000000000, because the twin skipped the 16-digit number it had just made. Numbers now count on exactly from any all-digit DocNumber whose next number still fits the field's 21 characters.
- An invoice whose `Line` is an object or text, not a list, gets 2010 naming `Line`, as a payment does, rather than 2020 "Required parameter Line is missing".
- A payment whose lines together overpay an invoice is refused with what the invoice has left after the payment's earlier lines ("has 40.00 left after this payment's earlier lines"), not its starting balance, which read as "a balance of 100.00, less than the 60.00 applied".
- A payment `LinkedTxn` with `TxnType` written `invoice` gets 2010 naming `Line.LinkedTxn.TxnType` and saying to write `Invoice`. Before, it got Unsupported operation: "The twin applies payments to invoices only, not to invoice."
- Customer search (`q`) finds text that runs from an address's street into its city when the address has no `street_line_2`, as every seeded address does. Before, the empty second line left a double space, and "7 Birch Ave Hillview" found nobody.
- The Housecall Pro 501 says "Its paths take no trailing slash" only when the path without the slash is one the twin serves for that method. Before, `GET /leads/` was sent to `/leads`, which answers 501 too, and `GET //` was told to "try ."
- `POST /jobs` numbers a job whose `invoice_number` is blank, as the docs say ("If left blank, one will be automatically generated"), rather than refusing it with a 422.
- `POST /jobs` refuses a schedule whose offset carries it past 9999. Before, the twin took it and answered `+010000-...` times, a `start_date` of `"10000-01-0"`, and a `scheduled_start` its own filters wouldn't read back.
- `POST /jobs` refuses `job_fields`, `schedule.anytime` or a line's `pricing_form` of the wrong type with a 422 naming the field. Before, `job_fields: "jt_1"` and `anytime: "yes"` made an ordinary job, and `pricing_form: false` got the 501 for price forms.
- `POST /jobs` without an `invoice_number` gets a 201 however many jobs the company has. Before, it answered 500 past about 130,000 jobs.
- A Jobber query whose variables don't coerce now gets the variable error with HTTP 200 before it's priced. A missing or null `Boolean` behind `@skip` or `@include` used to answer 500, and a page size sent as `"5"` or `3000000000` was priced from its raw value and throttled as a query that can never run.
- A Jobber `EncodedId` variable that `String()` or JSON can't write (an object whose `toString` isn't a function, or a value nested thousands deep) now gets the documented "was provided invalid value" error, not a 500.
- A Jobber query with a chain of fragment spreads too long for graphql-js to validate now gets HTTP 200 and an error saying it's nested too deeply, not a 500.
- Jobber's query cost charges a field once however many times it's selected. A field selected directly and again in a fragment used to cost twice, in both `requestedQueryCost` and what the bucket was charged.
- Jobber's requested cost stops at 9,007,199,254,740,991 instead of overflowing. Deeply nested page sizes used to make it `Infinity` (sent as `requestedQueryCost: null`), and a page size of 0 below that made it `NaN`, which let a query over the whole budget run unthrottled.
- The Jobber webhook `appId` is now a valid RFC 9562 UUID (version 8), so apps that validate it as one accept the twin's deliveries. About nine in ten used to fail a strict check, the README's `my-app` among them; the hash behind it is unchanged.
- A webhook app that is slow to answer no longer holds up deliveries to another URL. Before, a delivery queued while an earlier round was in flight waited for every app in that round, up to a stalled app's 3-second timeout, though the README promised URLs don't wait for each other.
- A reset, rewind, or scenario load while a webhook delivery is on its way no longer lets a round queued before it send deliveries queued after it at the old, later twin time. Before, a delivery held back by a `delayMs` fault could go out before it was due, and retries were counted from the wrong time.
- With a `latencyMs` fault rule ahead of an error rule, the same requests in the same order now meet the same errors, however much they overlap. Before, a request that arrived while another was held up took its roll of the dice in between that request's rolls, so which one got the error depended on real time.
- A scenario whose `startTime` or timeline `at` names a day the calendar doesn't have, such as 2026-02-30 or 2026-02-29, is refused with the field that is wrong. Before, it loaded and quietly rolled over into March.
- A rewind forgets every checkpoint taken after the one it goes to, as the docs say. Before, one taken after the clock moved but before anything was recorded survived, still listed at a later time than twin time, and rewinding to it jumped the clock forward and brought back fault dice from the discarded history.
- A rewind puts back the timeline as it stood at the checkpoint, so an entry still due then (one that failed and stopped the clock, or a second entry at the same instant) is due again and runs once it can. Before, every entry at or before the checkpoint's time was treated as done, and such an entry was gone from the schedule for good.
- A rewind puts the clock back to the exact moment of the checkpoint, fractions of a millisecond included, so the same requests afterwards record the same times. Before, after an advance of a fraction of a minute, the clock came back up to a millisecond early and a replayed write could record a different CreateTime.
- A scenario that asks for more than 1,000 technicians fails to load with a 400 saying so, and the twin stays as it was. Before, there was no limit and every technician was built in memory, so a typo like `technicians: 3000000` took the whole twin down, and every reset built it again.
- A scenario timeline action named `__proto__` is refused as unknown, like any action the vendor doesn't have. Before, the entry was dropped without a word and the scenario loaded with an empty timeline.
- A checkpoint with an empty name is refused, on every adapter. Before, `twin_checkpoint` took `""`, and then `twin_changes` since it answered nothing while `twin_export_log` since it answered the whole log.
- A timeline that brings in more new clients or customers than the twin has names for gets a 400 naming the entry and saying to bring in fewer, with the clock stopped there and the entry still due. Before, the advance answered a 500 calling it a bug in fieldtwin.
- A body over 10 MB sent to an OAuth endpoint (Jobber's and Housecall Pro's token endpoints, and QuickBooks' token and revoke endpoints) gets a 413 in OAuth's own format, `{ "error": "invalid_request", "error_description" }`, as their other errors are. Before, Jobber's and Housecall Pro's answered in their APIs' formats, which an OAuth client can't read.
- The world's history no longer claims that its most recently finished job always waits to be invoiced. In a drifted world, drift's own jobs can finish later than that, already invoiced and paid, as they need to be. What the rule is for still holds: every world, drifted or not, has finished work waiting to be invoiced, and a test now checks that across seeds.
- The dashboard's Business page names a QuickBooks invoice's customer as QuickBooks does after a rename. Before, it kept the name the invoice was created with, though `GET /invoice` answered the new one.
- The Business page lists invoices with the same status newest number first whatever order the event log has them in. Before, a DocNumber with letters in it, like `5x`, beside plain numbers left the rows in log order.
- The clock panel says "Moved 0 minutes ahead" for an advance of 0 minutes, which the twin accepts, rather than "Moved 0 days ahead".
- Loading a scenario no longer highlights most of the new event log as just arrived on the Events page. Events show as new only when they were added to the end of the log the page had already read, so after a reset, rewind, or scenario nothing is.
- The Jobber-to-QuickBooks example escapes backslashes in query values. A customer named "Smith \ Sons" used to be looked up as "Smith  Sons", so the sync missed the customer it had just created, and "Acme\" failed every run with 4000.
- The Jobber-to-QuickBooks example writes a colon in a client's name as a dash and a line break as a space, and cuts each name to its documented length. QuickBooks refuses those characters (2040), so a client named "Northside Plumbing: Commercial" used to fail every invoice on every run.
- The Jobber-to-QuickBooks example no longer counts a customer it created as "Name (email)" as "matched despite a different spelling". It used to log that customer for the bookkeeper again on every later run.
- Conformance recorder: a `QBO_ACCESS_TOKEN`, `JOBBER_ACCESS_TOKEN`, or `HOUSECALLPRO_API_KEY` with a line break, a space, or a character outside ASCII is refused by its variable's name before anything is sent. Before, fetch refused the header with an error that quoted it whole, and the preflight or a case printed it, token and all. Any error the preflight or a case reports also loses the run's credentials now, as answers already did.
- Conformance recorder: `QBO_API_BASE` written with a trailing dot (`https://quickbooks.api.intuit.com./v3`) is refused as production QuickBooks. Before, the fully qualified name passed the check while still reaching production, so the write cases could have created records in a real company.
- Conformance recorder: Housecall Pro's `schedule-without-an-offset` checks that filters were applied with a bound an hour past both readings of the job's time. For a company ahead of UTC, a bound just an hour later read on the company's clock still found the job, so the case recorded `not filtered` for filters that worked.
- Conformance recorder: the token check before recording says to try again later when a vendor answers 429, 502 to 504, or Jobber's `THROTTLED`, as the cases do. Before, it blamed `QBO_API_BASE`, `JOBBER_API_URL`, or `HOUSECALLPRO_API_URL`, so you went off to change settings that were already right.

## 0.5.3 - 2026-10-29

The MCP tools say more about themselves. Each carries MCP's tool annotations (read-only, destructive, idempotent, and whether it reaches outside the twin), has a title, and describes its parameters. The descriptions say what each tool leaves alone and what it answers with. Glama shows the annotations as tags and grades the descriptions. The twin itself is unchanged.

### Added

- Every MCP tool carries MCP's tool annotations: read-only, destructive, idempotent, and whether it reaches outside the twin. A client that asks before running a tool that changes things can now tell `twin_status` from `twin_reset`. Tests check the claims: every read-only tool changes nothing, and every idempotent one leaves the twin as one call did when called again.
- Every MCP tool has a title, and every parameter a description.

### Changed

- The MCP tools' descriptions say what each one leaves alone and what it answers with, and point to the tool to use instead where two are close (`twin_reset` and `twin_rewind`, `twin_changes` and `twin_export_log`). They live in `src/control/mcp-tool-text.ts`.

## 0.5.2 - 2026-10-29

The MCP server is in the official MCP Registry, as `io.github.nickgeorgeseo/fieldtwin`: the package now carries the `mcpName` the registry checks, and `server.json` describes how to start it, with `npx -y fieldtwin mcp` and the `FIELDTWIN_*` settings. `glama.json` claims its listing on Glama. The twin itself is unchanged.

### Added

- The MCP server has an entry in the official MCP Registry, `io.github.nickgeorgeseo/fieldtwin`, so MCP clients and directories that read the registry can find it and start it with `npx -y fieldtwin mcp`. `server.json` describes it, with the `FIELDTWIN_*` settings, and the package's `mcpName` proves the registry entry and the npm package belong together.
- `glama.json` names the owner as the MCP server's maintainer on Glama, whose listing punkpeye/awesome-mcp-servers asks for.

### Changed

- The README's MCP section says where the server is in the MCP Registry.

## 0.5.1 - 2026-10-29

On npm. `npx fieldtwin` starts the twin with no clone and no build, on plain Node 22 or newer, in any ready-made scenario or a scenario file of your own, and `npx fieldtwin mcp` gives a coding agent the twin and its MCP server in one command. Tests start their own twin with `startTwin()`, on a free port with its own world, so each test file or worker gets one and CI needs no second checkout. The MCP server now exits when the agent closes its stdin instead of holding the port, and `@hono/node-server` and `zod` move to new major versions, past advisories their old ones don't fix, so `npm audit` comes back clean.

### Added

- fieldtwin is an npm package: `npx fieldtwin` starts the twin with no clone and no build, on plain Node 22 or newer. The package holds the compiled twin and the ready-made scenarios, about 150 kB.
- The `fieldtwin` command: `fieldtwin [scenario]` starts the twin, in a ready-made scenario or a scenario YAML file, as `npm start` does; `fieldtwin mcp [scenario]` adds the MCP server over stdio, so a coding agent adds it with `claude mcp add fieldtwin -- npx -y fieldtwin mcp`. `--help` lists the scenarios and settings, and `--version` prints the version. Settings still come from the environment (`FIELDTWIN_PORT` and the rest).
- `startTwin()`, for tests: `import { startTwin } from "fieldtwin"` starts a twin on a free port with its own world and answers its `url`, `port`, and `close()`, so each test file, or each worker, can have its own. It takes `seed`, `auth`, `scenario`, `port`, and `hostname`, checks them as the command checks its settings, and throws instead of printing or exiting. It leaves the process's own `Request` and `Response` globals alone, and `close()` can be called more than once. Its types ship with it.

### Fixed

- The MCP server (`npm run mcp`, and now `fieldtwin mcp`) exits when the agent closes its stdin, as MCP's stdio lifecycle says to end a session. It used to keep running, and keep the port, until it was killed, so an agent that crashed could leave a twin on 4010 behind.

### Changed

- The README's quick start, testing, and MCP sections use the package: a test starts its own twin with `startTwin()`, and CI needs no second checkout.

### Security

- `@hono/node-server`, which serves the twin over HTTP, is on 2.x, past GHSA-rmxm-3fg6-px4f, which no 1.x release fixes. The advisory is in its `serveStatic`, which fieldtwin doesn't use, and 2.x keeps the API fieldtwin calls, so the twin answers as it did.
- `zod`, which checks scenarios, fault rules, webhook subscriptions, and MCP tool input, is on 4.x, past GHSA-mrhx-c7xc-m3w5 (memory exhaustion validating an oversized array), which no 3.x release fixes. What it accepts is unchanged; some refusals are worded differently, like `seed: Invalid input: expected number, received string`.

## 0.5.0 - 2026-10-26

A third twin. Housecall Pro joins Jobber and QuickBooks, served under `/housecallpro`: customers, addresses, employees, jobs, invoices, and estimates, with API keys and OAuth, webhooks signed as documented, scenario actions that finish, invoice, and pay work, and 33 conformance cases ready to record against a real account. It is in the dashboard and in `flaky-apis`, injected faults carry the vendor's own headers, and a scenario that fails to load, or a timeline entry that throws, now leaves the twin exactly as it was.

### Added

- A Housecall Pro twin, served under `/housecallpro`: set your client's base URL to `http://localhost:4010/housecallpro` and keep the rest of the path. It describes the same business as the other twins, as a field-service system like Jobber, and answers errors in Housecall Pro's documented format. Endpoints it doesn't model yet answer 501.
  - Customers, listed (paged, sorted, and searched with `q`), read, created, and updated, with their addresses; and employees.
  - Jobs, filtered as Get Jobs documents, with their line items, appointments, invoices, and a `work_status` that follows the work done. `POST /jobs` creates, schedules, and dispatches new ones.
  - Invoices, paid or open, filtered as Get Invoices documents, and estimates, approved or awaiting a response.
  - Scenario actions, for timelines and `POST /_twin/actions/housecallpro/...`: `newCustomers` brings in people new to the business, `completeJobs` has techs finish the jobs whose visits began first, `invoiceJobs` invoices the work finished longest ago, and `payInvoices` pays the open invoices due longest ago in full.
  - Webhooks (`customer.created`, `customer.updated`, `job.created`, `job.scheduled`, `job.completed`, `job.paid`, `invoice.created`, `invoice.sent`, `invoice.payment.succeeded`, `invoice.paid`) that carry the whole record, signed with `Api-Timestamp` and `Api-Signature` as documented.
  - API keys (`Authorization: Token <key>`), and an OAuth 2.0 server with 30-day access tokens and rotating refresh tokens.
- Conformance cases for Housecall Pro: 33 cases for 29 of its FIDELITY.md "check" rows, for `HOUSECALLPRO_API_KEY=... npm run conformance:record` to record. Housecall Pro has no sandbox, so they run in an account on the MAX or XL plan, reached with one of its API keys, which is never written anywhere. The cases that write say so before they run, and leave customers and jobs named "fieldtwin conformance ..." in the account, since its API can delete neither. The rows a request can't settle (webhooks, OAuth tokens, 429s, and what the app records as work gets done) are listed in conformance/README.md.
- Injected faults carry the headers a vendor sends with that error, through a new optional `errorHeaders` on the vendor contract: a Housecall Pro 429 has `RateLimit-Reset`, the epoch second a minute later in twin time, so backoff code that reads it can be tested.
- The fake business has a street address, zip code, and phone number of its own (in `GET /_twin`), which Housecall Pro's `GET /company` shows. They are drawn after everything else, so every seed still makes the same customers, technicians, and history.
- `pathExcludes` on fault rules: a request whose path has it in it is left alone, as `pathIncludes` picks the ones a rule applies to. `flaky-apis` uses it to keep Housecall Pro's OAuth endpoints up, since they share the prefix its API is served under.
- Housecall Pro in the dashboard. The Business page compares QuickBooks with Housecall Pro as well as with Jobber, the Events page names Housecall Pro's events and filters by them, and the control room makes its actions happen and offers two of its failures as fault presets: throttling with `RateLimit-Reset`, and customers created behind a lost answer.

### Changed

- The conformance recorder names each vendor's API terms before it runs, says that Housecall Pro's API can't delete the records its cases make, and, given a command it doesn't know, says which environment variables each vendor's recording needs.
- `flaky-apis` makes Housecall Pro fail too: one request in five throttled (429, with `RateLimit-Reset`), some 502s, one write in ten whose answer is lost after the customer, address, or job is made (504), and some webhooks late. Its customers pay the same two invoices Jobber's do, at the same moment. QuickBooks and Jobber meet exactly the faults they did, as their rules and dice are unchanged.
- An action run through the control plane (`POST /_twin/actions`, the `twin_run_action` MCP tool, or a dashboard button) draws its random choices from the length of the event log, and Housecall Pro's records make the seeded log longer: 410 events for the default seed instead of 282. So on the same seed, the same action makes different people than 0.4.1 did, and `jobber/newClients` names other clients. Scenario timelines draw theirs by their place in the timeline, so a scenario runs as before.
- `newClients`, like Housecall Pro's `newCustomers`, brings in at most 1,000 people at a time. The twin can name about 7,600 in all, and a larger count used to pass the check when a scenario loaded, then fail once the twin was half rebuilt, and fail every reset after it.
- The Business page pairs customers by email and invoices by number one to one. A customer or an invoice booked twice now shows as a row of its own, where before the second one hid the first: that duplicate is the bug a sync most needs to catch.

### Fixed

- Two requests that answered 500 now get the 400 or 422 that says what's wrong:
  - an action named like a property every object has, such as `constructor` or `toString`;
  - a QuickBooks or Housecall Pro request body with a value nested thousands of lists deep.
- A scenario whose timeline entry due at the start throws when it runs, though its check passed, leaves the twin as it was, like any other scenario that fails to load. Before, the twin had already been rebuilt from the new seed, its checkpoints gone, and every reset after that failed the same way. A reset that meets such an entry changes nothing either, rate-limit budgets and pending webhook deliveries included.
- An advance that reaches a timeline entry whose action throws stops the clock at the entry's time with the entry still due, so advancing again tries it again. Before, the advance answered an error but the entry was gone from the schedule, and the next advance went on as if it had happened.
- A timeline entry whose action throws is named in the error, as in `jobber newClients at 2026-07-13T12:00:00.000Z failed: ...`, and the control plane answers it as the bug in the twin it is: a 500, with the action's own stack in the log, rather than a 400 blaming the request.
- When an advance stops at such an entry, the webhooks for what happened on the way before it go out before the advance answers, as they do when it succeeds. Before, they waited for the next request.
- Housecall Pro's Create a Job answers 404 for a customer, address, or employee that doesn't exist before 501 for `job_fields`, as it already did for `pricing_form` and `schedule.anytime`, so a record that doesn't exist always wins over what the twin doesn't model.
- A Housecall Pro request with an empty `X-Company-Id` header is read as one without it, rather than refused with 403 for a blank location.
- A Housecall Pro webhook's `Api-Timestamp` and `Api-Signature` are made when the delivery goes out, not when the event happened, so a delivery a fault rule holds back passes a replay guard that rejects stale timestamps. For every vendor, a delivery's headers are now built at each attempt, with the twin time it is sent at; the body still carries the record as the event left it.
- Conformance recorder: a QuickBooks or Jobber answer that repeats the run's access token loses it before any case sees it, as a Housecall Pro answer repeating the API key already did, so a sandbox that echoes a header can't put the token in a recording or in what the recorder prints.
- Conformance recorder: the cases that send a body as it is (QuickBooks' and Jobber's `body-not-json`, and Jobber's `variables-as-a-string`) stop on an answer that says nothing about the API, as every other case does. A 429, a 502 to 504, Jobber's `THROTTLED`, or a 401 once the run's own token expired could be saved as their evidence.

## 0.4.1 - 2026-10-15

Faster to watch and to query. The dashboard reads only what is new in the event log and in the changes since a checkpoint, so following a long run no longer costs the whole history at every change, and it no longer shows events a rewind undid. Your own tools can follow the log the same way, with `?after=` and the `X-Twin-Log-Position` header. Jobber queries no longer slow down as the business grows: on a 400-customer world, a page of 100 clients with their jobs and invoices answers in 3.1 ms instead of 8.1 ms.

### Added

- `GET /_twin/log.jsonl?after=` reads only what was recorded since an earlier read, so following the log costs what is new rather than the whole history: on a 5,885-event log, one new event is 292 bytes to read instead of 3.2 MB. Every read says where the log ends in an `X-Twin-Log-Position` header, the last event's `seq` and a fingerprint of everything up to it; send that as `after` next time. If the log has changed in between (a reset, a rewind to before it, a scenario, or a restarted twin), the answer is 409, so a reader never mixes two histories.
- `GET /_twin/checkpoints/:name/changes` takes `after=` too, and says where the log ends, so a list of what your code changed can be followed the same way while it runs.

### Changed

- The dashboard reads only what is new, instead of all of it every time something changed: the Events and Business pages in the event log, and the control room in the changes since a checkpoint. On a 400-customer world, each change cost the Events page a 2.7 MB read; now a look with nothing new reads nothing, and a new event costs its own few hundred bytes.
- Jobber queries no longer slow down as the business grows. Each job on a page read every visit and invoice in the business to find its own; the twin now gathers which records belong to which once per change. On a 400-customer world, a page of 100 clients with their balances, jobs, and invoices answers in 3.1 ms instead of 8.1 ms and a page of 100 jobs in 0.6 ms instead of 2.2 ms, the same as on a 120-customer world. The answers are byte for byte what they were.

### Fixed

- The dashboard could go on showing events a rewind had undone, on the Events and Business pages and in the changes since a checkpoint, when as many new events arrived at the same twin time before its next look. It now sees any change to the log's history, a restarted twin included, and reads it again.

## 0.4.0 - 2026-10-11

A dashboard, and a README that says who fieldtwin is for. `dashboard/` drives a running twin from a browser, follows its event log live, and puts Jobber and QuickBooks side by side with every customer and invoice marked as matching or drifted, all without spending a rate limit or drawing a fault. The README shows what each kind of user gets and how to test on every commit, with a test that catches an invoice booked twice after a lost answer. Drifted books can now hold a customer the bookkeeper made inactive, and QuickBooks checks documented field lengths, reads payment text as text, and refuses request bodies over 10 MB.

### Added

- A web dashboard, in `dashboard/`: a Next.js package of its own (`cd dashboard && npm ci && npm run dev`, then http://localhost:4020). Its control room drives the clock, scenarios, actions, auth, faults, checkpoints, and webhook subscriptions, and shows each webhook delivery. Its Events page follows the event log live. Its Business page puts Jobber and QuickBooks side by side, with every customer and invoice marked as matching or drifted. It reads only the control plane, so watching spends no rate limit and draws no fault, and it serves this machine only.
- The README says who fieldtwin is for and what each kind of user gets from it, and shows how to test on every commit: a test that loads `flaky-apis`, runs your sync, and fails if a lost answer made it book an invoice twice, then the GitHub Actions workflow that starts a twin beside your code and keeps its event log when a test fails.
- A conformance case and a FIDELITY.md "check" row for an unquoted negative number in a QuickBooks query (`TotalAmt > -1`). The twin answers 4000, since the docs quote every value; quoted, `'-1'` works on both.
- Worlds can have customers the bookkeeper made inactive in QuickBooks who have called again since (`world.drift.inactiveInAccounting`): each is inactive in the books and has a job paid in Jobber in the last week, newer than the books. `mismatched-books` has one, so a sync that looks up active customers only creates a duplicate there, as it would in production.

### Fixed

- QuickBooks refuses text longer than the reference's documented maximum, with 2050 Invalid String Length: `DisplayName` (500), `GivenName` and `FamilyName` (100), `PrimaryPhone` (30), and `PrivateNote` on invoices and payments (4,000). Only `CompanyName` and `DocNumber` were checked, so a 5 MB `GivenName` was stored.
- QuickBooks reads a payment's `PaymentRefNum` and `PrivateNote` as text, as it does an invoice's: a number as its digits, and an object or list answers 2010. They were stored as sent.
- A request body over 10 MB answers 413, in the vendor's own error format on its paths, before the twin reads it. There was no limit, so a runaway client could use up the twin's memory. Neither vendor documents one, and no real request comes close.
- Reference integration: when a lost connection stops the webhook queue, the invoice it was syncing stays first in line. It went to the back, so after `resume()` invoices were synced out of the order their news came in.
- Reference integration: the webhook queue remembers the latest 10,000 invoices it synced, to count distinct ones, instead of every invoice it ever synced, so a server that runs for months doesn't grow without end.

## 0.3.0 - 2026-10-10

A production review of every area. QuickBooks queries take the whole documented language (`AND`, comparisons, `LIKE`, `ORDERBY`) and leave inactive records out, as Intuit's docs imply. `GET /` says where everything is, and every `curl` in the README runs in the tests. The reference integration is ready for several processes sharing one connection and survives lost connections, token endpoint outages, inactive customers, and two syncs at once. The conformance recorder can't save bad evidence. And more than fifty fixes, from webhooks that no longer wait on each other to faults that repeat after a rewind.

## 0.2.1 - 2026-10-09

The twin listens on this machine only unless you open it up with `FIELDTWIN_HOST`, and SECURITY.md says how to use it safely and how to report a vulnerability privately.

## 0.2.0 - 2026-10-09

The twins start talking back: webhooks from both vendors, signed and retried the way each one does it, with faults that deliver them twice or late. QuickBooks writes become safe to retry with `requestid`, and a new fault loses answers after the work is done to prove it. QuickBooks enforces its own rate limit, Jobber pages backwards, the reference integration reacts to webhooks, and a conformance suite stands ready to turn the twins' guesses into evidence against real sandboxes.

## 0.1.0 - 2026-10-09

The twins grow from customers and clients into the money: QuickBooks invoices, payments, items, queries, and change data capture; Jobber jobs, visits, quotes, and invoices with a history behind them; real OAuth on both; scenarios that play out over twin time; and a reference integration that syncs one into the other.

## 0.0.1 - 2026-10-09

The first sketch: QuickBooks Online customers and Jobber clients, the event log with checkpoints and rewind, seeded world generation, fault injection, scenarios, the `/_twin` control plane, and an MCP server.
