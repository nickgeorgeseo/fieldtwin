# Contributing to fieldtwin

Thanks for helping. fieldtwin is only useful if it behaves like the real APIs, so most of this guide is about accuracy: where a behavior comes from, how to prove it with a test, and how to say honestly how close it is.

Read [ARCHITECTURE.md](ARCHITECTURE.md) once before your first change. It is short, and it explains the three rules every change has to keep.

## Setup

Requires Node 22 or newer.

```bash
npm ci
npm test            # vitest, a few seconds
npm run typecheck   # tsc, no emit
npm run lint        # Biome: lint, formatting, and import order
npm run format      # let Biome fix formatting and import order for you
```

`npm run build` compiles `src/` to `dist/`, which is what the npm package ships; `npm pack` runs it first. `test/package.test.ts` builds and packs the package on every test run, and checks that the compiled command starts on plain Node.

CI runs typecheck, lint, and tests on Node 22 for every push and pull request. All three must pass before you open a pull request.

The dashboard is a package of its own. If you change it, also run `npm ci`, `npm test`, `npm run typecheck`, and `npm run build` in `dashboard/` ([dashboard/README.md](dashboard/README.md)); CI does.

## Ground rules

1. **Public documentation only.** Every vendor behavior must come from the vendor's public docs ([developer.intuit.com](https://developer.intuit.com/app/developer/qbo/docs/get-started), [developer.getjobber.com](https://developer.getjobber.com/docs), [docs.housecallpro.com](https://docs.housecallpro.com/)), with a link in a code comment. Never paste vendor code, private or login-only docs, or anything resembling real customer data.
2. **Don't invent silently.** If the docs don't settle a detail, pick the most conservative behavior, say so in a comment, and mark the FIDELITY.md row `Approximate` or `check`. A twin that is honest about its gaps is more useful than one that is confidently wrong.
3. **Fake data stays obviously fake.** Emails at `example.com`, phone numbers starting `555`.
4. **Keep the three rules.** All state changes go through `twin.record()`; time comes from `twin.clock` and randomness from `SeededRandom`; vendor state can always be rebuilt from the log. `test/determinism.test.ts` and `test/import-boundaries.test.ts` enforce the parts a machine can check.

## Adding an endpoint

This is the workflow for almost every contribution, whether it is a new QuickBooks entity, a new Jobber field, or a new error case. The order matters: docs first, test second, code last.

1. **Find the docs page.** Read the endpoint's page on the vendor's developer site. Note the exact field names, which fields are required, read-only, or system-computed, the error codes, and the limits. Copy the URL; you will need it three times.
2. **Add the FIDELITY.md row.** Before writing code, write the row: behavior, status (`Modeled`, `Approximate`, or `Not yet`), `docs only`, the docs link, and notes on anything the docs leave open. Writing it first keeps you honest about what you are claiming.
3. **Write the failing test.** Name it as a sentence about the behavior, written so someone who has never seen the code knows what the vendor does: `it("rejects an update that sends an old SyncToken (Stale Object Error)")`, not `it("works")`. Drive it through HTTP, the way a real client would (`test/helpers.ts` has `qboGet`, `qboPost`, `jobber`, `hcpGet`, `hcpPost`, and `hcpPut`). Run it and watch it fail.
4. **Types.** Add the record shape to the vendor's `types.ts` (or `types/`, as Housecall Pro has), named exactly as the vendor's docs name it (`SyncToken`, `DisplayName`, `invoiceStatus`), so the code can be checked against the docs line by line.
5. **Events.** Add the event payloads to `events.ts` (past tense: `InvoiceCreated`, `PaymentApplied`) and a line in `describeEvent()`. Events carry complete records, never "field X changed".
6. **`apply()`.** Teach `state.ts` to apply the new events. It must be deterministic and must not look at the clock, the network, or anything outside the event.
7. **Route or resolver.** Validate and decide, then call `twin.record()`. Return the vendor's real error body for every failure (`errors.ts` for REST vendors, `userErrors` or top-level `errors` for GraphQL). Put a comment with the docs link above any behavior a reader might be surprised by.
8. **Seed data**, if the entity should exist in the starting world. Seeds are built from the vendor-neutral world in `src/world/`, so every vendor describes the same business.
9. **Run everything:** `npm test && npm run typecheck && npm run lint`.
10. **CHANGELOG.md.** Add a line under `Unreleased`.

When a file passes about 200 lines, split it by job before adding more (see "Code style" in ARCHITECTURE.md).

## Adding a vendor

See "Adding a vendor" in [ARCHITECTURE.md](ARCHITECTURE.md). Open an issue first: a new vendor is a bigger conversation than a new endpoint.

## Good first contributions

- One more field on an existing record, with its docs link.
- An error case the twin doesn't return yet.
- A scenario in `scenarios/` that reproduces a situation you've hit in production.
- Turning a `check` row in FIDELITY.md into a confirmed one, with a link to the docs that settle it, or with a conformance recording from a real sandbox (see [conformance/README.md](conformance/README.md)).

## Pull requests

- One logical change per commit, each with its test. Small pull requests get reviewed fast.
- Commit messages say what changed and why. If the change came from a docs page, link it.
- Don't mix formatting changes with behavior changes; run `npm run format` in its own commit if needed.

## Dependencies

Runtime dependencies are kept deliberately few (see "Small, boring dependencies" in ARCHITECTURE.md). Propose a new one in an issue first. Dev dependencies for tests and tooling are fine. The dashboard's Next.js, React, and Tailwind live in `dashboard/package.json`, never in the twin's.

If you change dependencies, regenerate the lockfile with npm 11 or newer (`npx npm@11 install`): npm 10.9 crashes while resolving vitest 4's optional peer dependencies from scratch. Installing *from* the lockfile works on any npm.

## Reporting a bug

Include the seed, the scenario (if any), and the event log: `curl localhost:4010/_twin/log.jsonl > log.jsonl`. With those, anyone can replay your exact run.

If the twin disagrees with the real API, that is a fidelity bug and the most valuable kind of report. Please include the docs link or a redacted real response, never real customer data.

Security problems are different: report them privately, as [SECURITY.md](SECURITY.md) describes, not in a public issue.
