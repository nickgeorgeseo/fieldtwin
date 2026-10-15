# Changelog

All notable changes to fieldtwin. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow [Semantic Versioning](https://semver.org/).

## Unreleased

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
