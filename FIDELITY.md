# Fidelity

What each twin models, how closely, and whether it has been checked against the real service.

**Modeled** means it behaves like the public docs describe. **Approximate** means the shape is right but details differ. **Not yet** means calls fail clearly instead of returning wrong data.

**Verified** means checked against a live vendor sandbox, with the date. Until the conformance suite exists (roadmap v0.3), everything is built from public documentation and marked "docs only". Anything marked "check" is our best reading of the docs and should be confirmed first.

## QuickBooks Online

| Behavior | Status | Verified | Notes |
|---|---|---|---|
| `GET /customer/{id}` | Modeled | docs only | |
| `POST /customer` create | Modeled | docs only | DisplayName derived from GivenName + FamilyName when missing |
| `POST /customer` update with SyncToken | Modeled | docs only | Stale token returns error 5010 |
| Sparse vs full update | Modeled | docs only | Full update clears omitted writable fields |
| Unique DisplayName | Approximate | docs only | Real QuickBooks checks across customers, vendors, and employees. Twin checks customers only |
| `GET /query` | Approximate | docs only | `SELECT *`, one `WHERE Field = 'value'`, `STARTPOSITION`, `MAXRESULTS`. No `POST /query`, no `COUNT(*)`, no `LIKE` |
| Error codes 610, 2020, 4000, 6240 | Modeled | check | Message wording is approximate |
| Auth failure code 3200, throttle code 003001 | Approximate | check | Real wrong-realm responses may differ |
| `minorversion` parameter | Not yet | | Accepted and ignored |
| OAuth 2.0 | Not yet | | Any bearer token is accepted |
| Rate limits | Via faults | | Use a fault rule with status 429 |
| Webhooks, CDC, other entities | Not yet | | Roadmap v0.1 and v0.2 |

## Jobber

| Behavior | Status | Verified | Notes |
|---|---|---|---|
| Single endpoint `POST /api/graphql` | Modeled | docs only | |
| `X-JOBBER-GRAPHQL-VERSION` required | Modeled | docs only | Only `2025-04-16` is accepted. The real error response for a missing header is unconfirmed |
| `account`, `client`, `clients` queries | Modeled | docs only | Small field subset (see `schema.graphql`) |
| Relay-style cursor pagination | Modeled | docs only | Cursors are opaque, as in the real API |
| Encoded ids | Approximate | check | Base64 of `gid://Jobber/Type/n`. Treat ids as opaque |
| Query cost bucket: 10,000 points, 500/sec refill | Modeled | docs only | |
| `extensions.cost` and `THROTTLED` errors | Modeled | docs only | |
| Query cost formula | Approximate | | Right shape (page size and nesting raise cost; a missing `first` assumes 100 nodes). Numbers will not match Jobber exactly |
| 2,500 requests per 5 minutes DDoS guard | Via faults | | Use a fault rule with status 429 |
| Mutations | Not yet | | Roadmap v0.1 |
| Webhooks (HMAC-SHA256 signed) | Not yet | | Roadmap v0.2 |
| OAuth 2.0 | Not yet | | Any bearer token is accepted |
