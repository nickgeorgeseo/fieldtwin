# Changelog

All notable changes to fieldtwin. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow [Semantic Versioning](https://semver.org/).

## Unreleased

### Added

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
