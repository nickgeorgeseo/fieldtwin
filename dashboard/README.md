# fieldtwin dashboard

A web dashboard for a running fieldtwin. Drive the twin from a browser, and watch what your code or agent does to Jobber and QuickBooks while it runs.

```bash
npm start                                   # in the project folder: the twin, at http://localhost:4010
cd dashboard && npm ci && npm run dev       # in another terminal: the dashboard, at http://localhost:4020
```

`FIELDTWIN_URL` points it at a twin somewhere other than `http://localhost:4010`, as it does for the reference integration.

## What's on it

| Page | What it does |
|---|---|
| **Control room** | The company, its twin time in its own time zone, and how the twin is set up. Move the clock, with what the scenario has scheduled next. Load a ready-made scenario or your own YAML, and reset. Make Jobber customers pay or new clients call in. Switch between any-token and real OAuth. Mark checkpoints, list what changed since (everything, or only what your code did), download the log since one, and rewind. Set fault rules from presets, and webhook subscriptions, and watch each delivery: its tries, the last answer, and the fault that duplicated or delayed it |
| **Events** | The event log as it grows, newest first. Filter by vendor and by who made each change, search for a name or Id, pause. Each event opens to the whole record it carries |
| **Business** | Jobber and QuickBooks side by side. Customers matched by email and invoices by number, each marked with how the systems agree: the same, spelled differently, inactive in the books, only in one, a payment not recorded, a paid invoice never booked. Load `mismatched-books`, then run `npm run example:sync` and watch the red go |

## How it reaches the twin

Like `examples/`, the dashboard is a client of the twin and imports nothing from `src/` (`test/import-boundaries.test.ts` checks). Its pages call `/api/twin/...`, which the dashboard's server forwards to the twin's `/_twin/...` control plane and nowhere else ([`lib/forward.ts`](lib/forward.ts)).

It never calls the vendor APIs. The Business page rebuilds both vendors' records from the event log instead, since every event carries the whole record it changed ([`lib/books.ts`](lib/books.ts)). Reading through the vendor APIs would spend their rate limits and draw from the seeded faults your own code meets, so watching would change what you're watching.

The control plane has no authentication, so the dashboard won't lend it to anyone else ([`lib/request-guard.ts`](lib/request-guard.ts)). It listens on 127.0.0.1, answers only requests addressed to `localhost`, `127.0.0.1`, or `[::1]` (a site that rebinds its DNS name to this machine still sends its own name), and takes changes only from its own pages (browsers send `Origin` with every POST and PUT).

Two things it can't show, because the twin doesn't say: the fault rules themselves (`GET /_twin` names the active ones) and webhook secrets. So the fault and webhook editors replace the whole list. The actions it offers are the ones the Jobber twin has today (`payInvoices`, `newClients`).

## Working on it

A package of its own, so Next.js, React, and Tailwind stay out of the twin's dependencies. From `dashboard/`:

```bash
npm test            # Node's own test runner, a second or two: the logic in lib/
npm run typecheck   # next typegen, then tsc
npm run build
```

Lint and formatting run from the project folder (`npm run lint`), with the rest of the project. CI runs all of it.

Tests use Node's built-in runner, which runs TypeScript as it is, so the dashboard needs no test dependency. That is why `lib/` imports end in `.ts`, as in `src/`. The logic that matters lives in `lib/` as plain functions with tests; the components in `components/` only show it.
