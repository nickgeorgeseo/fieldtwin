# Sync paid Jobber invoices to QuickBooks

A reference integration, written the way production code has to be: it retries politely, keeps OAuth tokens alive, survives stale records and drifted customer names, and can run any number of times without booking anything twice. It talks to the vendors only over HTTP, so the same code runs against fieldtwin or the real APIs.

For every Jobber invoice that is paid and has changed since the last run, it:

1. **Finds or creates the customer** in QuickBooks, matching by email. Names drift between systems ("Lindqvist" in Jobber, "Lindquist" in the books); email addresses don't. A customer the books spell differently is matched and left alone, with a line in the log.
2. **Finds or creates the invoice**, with Jobber's invoice number as the `DocNumber` and each line booked to the QuickBooks Item of the same name.
3. **Records the payment**: whatever is still open, up to what Jobber says was paid, once (`PaymentRefNum` `JOBBER-<number>`).
4. **Stamps the invoice** with `Synced from Jobber invoice #<number>` in `PrivateNote`.

It finds those invoices two ways: on a schedule, by paging through Jobber's invoices since the last run, and as they happen, from Jobber's `INVOICE_UPDATE` webhooks, syncing just the invoice each one names.

## Run it

```bash
npm start                  # terminal 1: the twin
npm run example:sync       # terminal 2: the demo
```

```text
Connected to QuickBooks (company 9341000000000001) and Jobber at http://localhost:4010.
Run 1: every paid Jobber invoice.
  26 paid invoices: 2 booked, 8 payments recorded, 26 stamped, 0 customers created, 0 matched despite a different spelling, 8 stale SyncTokens recovered, 0 conflicts, 0 failed.
Run 2, two hours of twin time later: invoices paid since run 1 began (2026-07-13T11:00:00.000Z), with refreshed tokens.
  0 paid invoices: 0 booked, 0 payments recorded, 0 stamped, 0 customers created, 0 matched despite a different spelling, 0 stale SyncTokens recovered, 0 conflicts, 0 failed.
Run 3, from webhooks: subscribed to INVOICE_UPDATE, two customers pay.
  2 paid invoices: 0 booked, 2 payments recorded, 2 stamped, 0 customers created, 0 matched despite a different spelling, 2 stale SyncTokens recovered, 0 conflicts, 0 failed.
```

The demo connects to both vendors through the twin's OAuth endpoints, syncs, sleeps two hours, and syncs again. Then it serves its webhook handler on a local port, subscribes it to `INVOICE_UPDATE` through the twin's control plane, has two customers pay (`POST /_twin/actions/jobber/payInvoices`), and books those payments as the signed webhooks arrive. Sleeping advances the twin's clock over the control plane, so a 60-second backoff takes no real time and the two-hour gap expires the access tokens for real.

For a rougher ride, start the twin with real OAuth checks and faults on both vendors:

```bash
npm start -- flaky-apis
```

The demo then logs every retry (QuickBooks 429s wait 60 seconds, 503s back off, and writes whose answer was lost are answered from their `requestid` on the retry), refreshes its tokens mid-run, and the second run picks up the invoices customers paid while the first was struggling. `FIELDTWIN_URL` points the demo at a twin on another address.

## What production code has to get right, and where this does

| Problem | Where | What it does |
|---|---|---|
| Transient failures | [`retry.ts`](src/retry.ts) | Retries 429, 500, 502, 503, 504, network errors, and timeouts. Honors `Retry-After`; otherwise exponential backoff with full jitter |
| QuickBooks throttling | [`quickbooks.ts`](src/quickbooks.ts) | A 429 waits 60 seconds, as [Intuit's limits page](https://developer.intuit.com/app/developer/qbo/docs/learn/limits-and-throttles) says |
| Jobber's query-cost limit | [`jobber.ts`](src/jobber.ts) | On `THROTTLED`, waits `ceil((requestedQueryCost - currentlyAvailable) / restoreRate)` seconds, exactly enough. A query costing more than the whole budget fails at once, since it would [never run](https://developer.getjobber.com/docs/using_jobbers_api/api_rate_limits) |
| Jobber's request limit | [`jobber.ts`](src/jobber.ts) | The DDoS guard's 429 backs off with jitter |
| Retrying a write safely | [`quickbooks.ts`](src/quickbooks.ts) | Every QuickBooks write carries a [`requestid`](https://developer.intuit.com/app/developer/qbo/docs/learn/learn-basic-field-definitions) made from a hash of the write, the same on every retry, so a create whose answer was lost isn't applied twice |
| Two syncs at once | [`quickbooks.ts`](src/quickbooks.ts) | The scheduled sync and a webhook's sync can reach the same invoice together. Both make the identical write with the identical requestid, so QuickBooks books it once, with no lock to manage |
| Expiring tokens | [`oauth.ts`](src/oauth.ts) | Refreshes five minutes early, and once more after a 401 |
| Rotating refresh tokens | [`oauth.ts`](src/oauth.ts) | One refresh at a time (Jobber [kills the old refresh token](https://developer.getjobber.com/docs/building_your_app/refresh_token_rotation/) the moment it issues a new one, so parallel refreshes race), and every new token set goes to `onTokens` to be saved. With `loadTokens`, processes that share a connection pick up the set another one rotated to, instead of asking the person to reconnect |
| Stale records | [`sync.ts`](src/sync.ts) | Recording a payment changes the invoice, so the stamp that follows meets 5010 (Stale Object). It reads the invoice again and retries |
| Drifted names | [`sync-customers.ts`](src/sync-customers.ts) | Matches customers by email; never renames one; creates the ones the books don't have, as "Name (email)" if the name is taken |
| Running twice | [`sync.ts`](src/sync.ts) | Every step looks before it writes. A second run changes nothing; a run that died halfway is finished by the next |
| Trusting a webhook | [`webhooks.ts`](src/webhooks.ts) | Verifies `X-Jobber-Hmac-SHA256` over the raw body in constant time before anything else, and refuses what doesn't verify |
| Answering a webhook in time | [`webhooks.ts`](src/webhooks.ts), [`invoice-queue.ts`](src/invoice-queue.ts) | Jobber allows [one second](https://developer.getjobber.com/docs/using_jobbers_api/setting_up_webhooks/): the handler only verifies and queues, and the sync runs in the background |
| Losing the connection | [`invoice-queue.ts`](src/invoice-queue.ts) | An `OAuthError` pauses the webhook queue instead of failing every invoice or crashing the server. What hadn't synced stays queued, news keeps arriving, and `resume()` carries on once the person reconnects |
| Clocks that disagree | [`jobber-invoices.ts`](src/jobber-invoices.ts) | The scheduled sync reads again what changed in the ten minutes before its cutoff: your server's clock and Jobber's never agree exactly, and reading an invoice twice is harmless where missing one is not |
| Prices finer than a cent | [`sync.ts`](src/sync.ts) | QuickBooks refuses a line whose Amount isn't Qty × UnitPrice to the cent (6070). A Jobber line that doesn't add up is booked at its total, with the pricing in its description, rather than failing every run |
| Repeated and out-of-order webhooks | [`invoice-queue.ts`](src/invoice-queue.ts) | Queues invoice ids, not events, so news about an invoice already waiting is folded in, and reads each invoice as it is when its turn comes. A payment's two `INVOICE_UPDATE`s, redeliveries, and late arrivals all end in one booking |

[`twin.ts`](src/twin.ts) is the only twin-specific file: it connects without a browser, sleeps on twin time, subscribes to webhooks, and makes customers pay. Everything else is what you would ship.

## Production wiring

Four things change, and none of them is in the sync itself:

1. **Endpoints.** Use `VENDOR_ENDPOINTS` from [`endpoints.ts`](src/endpoints.ts) instead of `endpointsAt(twinUrl)`.
2. **The runtime.** Use `systemRuntime()` from [`runtime.ts`](src/runtime.ts): real `fetch`, `setTimeout`, `Date.now`, and `Math.random`.
3. **Connecting.** Send the person to the authorize URL with your `client_id`, `redirect_uri`, a random `state` tied to their session, and (for QuickBooks) `scope=com.intuit.quickbooks.accounting`. In your callback, check `state`, then call `exchangeCode(oauth, code, redirectUri, runtime)`. Save the tokens, and QuickBooks' `realmId` from the callback.
4. **Tokens and the schedule.** Load saved tokens into a `TokenManager` with an `onTokens` that saves them again. Run the sync on a schedule, passing the time the last clean run started:

```ts
const runtime = systemRuntime();
const jobberTokens = new TokenManager(jobberOAuth, await db.tokens("jobber"), runtime, {
  onTokens: (tokens) => db.saveTokens("jobber", tokens), // Jobber's old refresh token is already dead
  loadTokens: () => db.tokens("jobber"), // another process (the webhook server, say) may have refreshed first
});
// ...the same for QuickBooks, then createJobberClient and createQuickBooksClient as in main.ts

const startedAt = new Date().toISOString();
const stats = await syncPaidInvoices({ jobber, quickbooks, log: runtime.log }, await db.lastCleanRun());
if (stats.failed === 0) await db.saveLastCleanRun(startedAt); // otherwise the next run tries those invoices again
if (stats.conflicts > 0) alertTheBookkeeper(stats);
```

An `OAuthError` from a run means the connection is gone (the refresh token was revoked or lost): ask the person to connect again.

**Webhooks.** Mount `jobberWebhookHandler` at a public HTTPS URL in any framework that speaks `Request` and `Response`, add that URL and the `INVOICE_UPDATE` topic to your app in Jobber's Developer Center, and run an `InvoiceQueue` (or your job queue) behind it, calling `syncPaidInvoice`. When `queue.connectionLost` is set, ask the person to reconnect, then call `queue.resume()`. Keep the scheduled sync too, less often: webhooks can be missed, and Jobber may switch them off for an app whose endpoint keeps failing.

## What the tests prove

The tests in [`test/`](test/) run the code against an in-process twin with real OAuth checks: requests go straight to the twin's app, sleeping advances twin time, and nothing waits in real time.

| Test | Proves |
|---|---|
| [`sync.test.ts`](test/sync.test.ts) | Every paid invoice ends in QuickBooks with Balance 0, the right customer, and its payment. A second run changes nothing (the twin's change list shows no API calls that wrote anything). Every payment's stale SyncToken is recovered. Invoices a timeline pays an hour later are picked up by the next run. After two hours both tokens refresh and Jobber's rotated refresh token is kept |
| [`sync-drift.test.ts`](test/sync-drift.test.ts) | Under `mismatched-books`, respelled customers are matched by email (no duplicates, not renamed) and field-service-only customers are created. Switching to name matching fails all three tests |
| [`sync-flaky.test.ts`](test/sync-flaky.test.ts) | Under `flaky-apis`, repeated runs settle to exactly the books a clean run produces, through more than a hundred retries, writes whose answers were lost, and a token refresh. When every answer to an invoice write is lost, each invoice is still made once; a client without `requestid`s makes eight copies, one per attempt |
| [`jobber.test.ts`](test/jobber.test.ts), [`quickbooks.test.ts`](test/quickbooks.test.ts), [`oauth.test.ts`](test/oauth.test.ts), [`retry.test.ts`](test/retry.test.ts) | Each piece on its own: exact throttle waits, the 60-second QuickBooks wait, one `requestid` per write across retries, single-flight refresh, backoff and `Retry-After` |
| [`webhooks.test.ts`](test/webhooks.test.ts) | A delivery whose signature doesn't verify is refused. Invoices paid after the backfill are booked from their webhooks, fetching only those invoices. Under `flaky-apis`, with webhooks sent twice and late, each invoice is still booked once and nobody pays twice |
| [`production-hazards.test.ts`](test/production-hazards.test.ts) | Two syncs at once book each invoice and payment once. A lost connection pauses the webhook queue, keeps its invoices, and resumes after reconnecting. An invoice changed just before the cutoff, or five minutes after it by a skewed clock, is still found. A line that doesn't add up is booked at its total |
| [`demo.test.ts`](test/demo.test.ts) | The demo itself, end to end, through the control plane, with the twin delivering webhooks over real HTTP |

## What this example doesn't do

- **Partial payments.** It syncs fully paid invoices and records one payment for each. Jobber's `paymentRecords` fields aren't in the public docs, so it can't book each Jobber payment separately.
- **Sales tax.** The twin has none. If QuickBooks adds tax to an invoice, the totals differ, the sync logs it, and the tax stays open in the books.
- **Edits after booking.** An invoice already in QuickBooks isn't updated when it changes in Jobber, and voids and refunds aren't synced.
- **Server-side filtering.** Jobber's filter arguments aren't in the public docs, so every scheduled run pages through all invoices and filters them here. Webhooks avoid that for everything that happens while the app is subscribed.
- **Dates.** `TxnDate` and `DueDate` are the date part of Jobber's timestamps, as Jobber wrote them.

Some behaviors the code depends on are the twin's best reading of the docs rather than confirmed facts, notably that applying a payment bumps an invoice's SyncToken. If real QuickBooks doesn't, the stamp simply succeeds the first time. [FIDELITY.md](../../FIDELITY.md) marks each one.
