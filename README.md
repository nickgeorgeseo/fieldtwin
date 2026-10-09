# fieldtwin

**Local, stateful twins of the software that trades and logistics businesses run on.**

Point your integration, script, or AI agent at `http://localhost:4010` instead of the real Jobber or QuickBooks Online API. You get a believable fake company (customers, technicians, history) that behaves like the real services, including the annoying parts: rate limits, stale-record errors, pagination, and outages you can switch on.

Nothing touches a real customer's account. Every run starts from the same seed, so a bug you hit once you can hit again.

> Status: early sketch (v0.0.1). QuickBooks customers and Jobber clients work end to end. See [FIDELITY.md](FIDELITY.md) for exactly what is modeled.

## Why this exists

Building for field-service and logistics operators usually means one of three bad options: test against a client's live account, wait on vendor sandbox access, or write mocks that only return what you expected. None of these work for AI agents, which need somewhere they can make mistakes, many times, in parallel.

The real vendors do offer test accounts (Jobber has developer testing accounts; Intuit has sandbox companies). fieldtwin is not a replacement for them. It adds what they cannot: instant resets, a full history of what your code changed, rewind, controllable time, failures on demand, and both systems describing the same fake business so you can test the sync between them.

## Quick start

Requires Node 22+.

```bash
git clone https://github.com/<you>/fieldtwin && cd fieldtwin
npm install
npm start
```

```text
fieldtwin: Thorne Heating & Air is open for business at http://localhost:4010
```

Read a customer from the QuickBooks twin (any bearer token works for now):

```bash
curl -H "Authorization: Bearer dev" \
  http://localhost:4010/v3/company/9341000000000001/customer/1
```

List clients from the Jobber twin:

```bash
curl -X POST http://localhost:4010/api/graphql \
  -H "Authorization: Bearer dev" \
  -H "X-JOBBER-GRAPHQL-VERSION: 2025-04-16" \
  -H "Content-Type: application/json" \
  -d '{"query":"{ clients(first: 5) { nodes { id name } totalCount } }"}'
```

## Using it with your code

Change only the base URL. Paths, headers, and body shapes match the real APIs.

| Vendor | Real base URL | Twin base URL |
|---|---|---|
| QuickBooks Online | `https://quickbooks.api.intuit.com` | `http://localhost:4010` |
| Jobber | `https://api.getjobber.com` | `http://localhost:4010` |

The QuickBooks twin serves one company, realm `9341000000000001`.

## The control plane

Everything under `/_twin` controls the fake world rather than imitating a vendor.

| Request | What it does |
|---|---|
| `GET /_twin` | Company, twin time, event count, active faults |
| `POST /_twin/reset` | Back to the seeded starting world |
| `POST /_twin/clock/advance` `{"minutes": 60}` | Move time forward (rate limits refill, timestamps move) |
| `POST /_twin/checkpoints/:name` | Name this moment |
| `GET /_twin/checkpoints/:name/changes?source=api` | What your code changed since then |
| `POST /_twin/checkpoints/:name/rewind` | Undo everything after the checkpoint |
| `PUT /_twin/faults` | Replace the active fault rules |
| `POST /_twin/scenario` (YAML body) | Load a scenario |
| `GET /_twin/log.jsonl` | The full event log, one event per line |

A typical agent test:

```bash
curl -X POST localhost:4010/_twin/checkpoints/before-agent
# ...run your agent against the twin...
curl "localhost:4010/_twin/checkpoints/before-agent/changes?source=api"
curl -X POST localhost:4010/_twin/checkpoints/before-agent/rewind
```

## Using it from a coding agent (MCP)

`npm run mcp` starts the twin and an MCP server over stdio with six tools: `twin_status`, `twin_reset`, `twin_advance_clock`, `twin_checkpoint`, `twin_changes`, `twin_rewind`.

Claude Code:

```bash
claude mcp add fieldtwin -- npx tsx /path/to/fieldtwin/src/mcp.ts
```

The MCP tools only control the test world. Your agent still calls the vendor APIs over HTTP, the same way production code will.

## Scenarios and faults

A scenario is a YAML file: seed, start time, world size, and active faults.

```bash
npm start -- scenarios/heat-wave-monday.yaml
```

```yaml
faults:
  - name: qbo-throttled-writes
    vendor: quickbooks
    method: POST
    rate: 0.2            # one in five matching requests
    effect: { status: 429, message: "ThrottleExceeded" }
```

Injected failures come back in the vendor's own error format and carry an `X-Twin-Fault` header, so you can tell them apart from real bugs.

## Project layout

```text
src/
  core/        the twin runtime: event log, clock, seeded randomness, vendor contract
  world/       generates the vendor-neutral fake business
  vendors/
    quickbooks/  one folder per vendor, all with the same shape
    jobber/
  faults/      makes vendor APIs misbehave on purpose
  control/     /_twin HTTP routes, MCP tools, scenarios (one shared operations.ts)
  app.ts       wires it together
  server.ts    entry point for `npm start`
  mcp.ts       entry point for `npm run mcp`
scenarios/     ready-made situations
test/          one test file per vendor, plus core and the architecture guards
```

Read [ARCHITECTURE.md](ARCHITECTURE.md) before changing anything in `core/`.

## Contributing

Contributions are welcome, especially ones that make the twins more faithful. [CONTRIBUTING.md](CONTRIBUTING.md) walks through adding an endpoint, from the vendor's docs page to the test to the FIDELITY.md row. Build only from public documentation; never paste vendor code, private docs, or real customer data.

## Disclaimer and license

fieldtwin is an independent project. It is not affiliated with, endorsed by, or supported by Jobber or Intuit. Jobber and QuickBooks are trademarks of their respective owners.

Copyright 2026 Nick George. Licensed under the [Apache License 2.0](LICENSE).
