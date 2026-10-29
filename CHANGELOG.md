# Changelog

All notable changes to fieldtwin. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow [Semantic Versioning](https://semver.org/).

## Unreleased

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
