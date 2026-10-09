# Changelog

All notable changes to fieldtwin. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow [Semantic Versioning](https://semver.org/).

## Unreleased

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
