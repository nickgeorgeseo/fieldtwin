# Fidelity

What each twin models, how closely, and whether it has been checked against the real service.

**Modeled** means it behaves like the public docs describe. **Approximate** means the shape is right but details differ. **Not yet** means calls fail clearly instead of returning wrong data.

**Verified** means checked against a live vendor sandbox, with the date. Until the conformance suite exists (roadmap v0.3), everything is built from public documentation and marked "docs only". Anything marked "check" is our best reading of the docs and should be confirmed first.

## QuickBooks Online

| Behavior | Status | Verified | Docs | Notes |
|---|---|---|---|---|
| `GET /customer/{id}` | Modeled | docs only | [Customer][qbo-customer] | |
| `POST /customer` create | Modeled | docs only | [Customer][qbo-customer] | DisplayName derived from GivenName + FamilyName when missing |
| `POST /customer` update with SyncToken | Modeled | docs only | [Customer][qbo-customer] | A stale SyncToken answers 5010 `Stale Object` |
| Sparse vs full update | Modeled | docs only | [Customer][qbo-customer] | Full update clears omitted writable fields |
| Unique DisplayName | Approximate | docs only | [Error codes][qbo-errors] | Real QuickBooks checks across customers, vendors, and employees. Twin checks customers only. 6240 names the Id that has the name |
| `GET /query` | Approximate | docs only | [REST basics][qbo-rest] | `SELECT *`, one `WHERE Field = 'value'`, `STARTPOSITION`, `MAXRESULTS`. No `POST /query`, no `COUNT(*)`, no `LIKE` |
| Error bodies 610, 2020, 4000, 4001, 5010, 6240 | Modeled | docs only | [Error codes][qbo-errors] | `Message` is copied from the reference, which documents it as literal. `Detail` fills in the reference's templates and may not match real responses word for word |
| HTTP status of 610 on a read | Approximate | check | [Error codes][qbo-errors] | Twin answers 400. The docs list both 400 and 404 without saying which a missing Id gets |
| Missing or invalid token: 401 `AuthenticationFault` 3200 | Modeled | docs only | [Error codes][qbo-errors] | |
| Wrong realm: 403 `AuthorizationFault` 3100 | Approximate | check | [Error codes][qbo-errors] | 3100 is the only documented 403 code. The real `Message` for a token used on another company is unconfirmed |
| Throttling: HTTP 429 | Via faults | docs only | [Limits][qbo-limits] | Use a fault rule with status 429. Intuit documents the status and "wait 60 seconds"; the body (code 003001, `ThrottleExceeded`) is widely reported but not in the docs: check |
| Injected 5xx errors | Modeled | docs only | [Error codes][qbo-errors] | Code 10000, `SystemFault` |
| `minorversion` parameter | Not yet | | | Accepted and ignored |
| OAuth 2.0 | Not yet | | | Any bearer token is accepted |
| Webhooks, CDC, other entities | Not yet | | | Roadmap v0.1 and v0.2 |

## Jobber

| Behavior | Status | Verified | Notes |
|---|---|---|---|
| Single endpoint `POST /api/graphql` | Modeled | docs only | |
| `X-JOBBER-GRAPHQL-VERSION` versions | Modeled | docs only | Every version the changelog lists as active is accepted and echoed in `extensions.versioning.version`. Historic versions resolve to the oldest active one. The twin serves the same schema subset for every version |
| Missing or unknown version header | Approximate | check | The docs require the header but don't show the failure. The twin answers 400 with a GraphQL error naming the active versions. Deprecation `warning`s are not sent (end-of-support dates aren't published) |
| `account`, `client`, `clients` queries | Modeled | docs only | Small field subset (see `schema.graphql`) |
| Relay-style cursor pagination | Modeled | docs only | Cursors are opaque, as in the real API |
| Encoded ids | Modeled | docs only | Base64 of `gid://Jobber/Type/n`, as the docs show. Treat ids as opaque |
| Base64 padding on ids | Approximate | check | The twin pads (`=`). Jobber's own examples disagree: one padded, one not |
| Invalid `EncodedId` variable | Modeled | docs only | The documented `Variable $id of type EncodedId! was provided invalid value` error with `extensions.problems` |
| Unknown id | Modeled | docs only | Resolves to `null`, not an error |
| Syntax and validation errors | Approximate | docs only | HTTP 200 with an `errors` list, as documented. Messages come from graphql-js, so wording differs from Jobber's (which runs graphql-ruby) |
| Query cost bucket: 10,000 points, 500/sec refill | Modeled | docs only | One budget per app, as documented (per app and account; the twin has one account). Until OAuth, each access token counts as one app. Reset and rewind start every budget full |
| `extensions.cost` and `THROTTLED` errors | Modeled | docs only | |
| Query cost formula | Modeled | docs only | One point per field; `edges`, `nodes`, `node`, and connection fields free; per-node fields multiplied by `first`/`last` or 100. Reproduces the docs' 7, 50, and 500 point examples |
| `actualQueryCost` | Modeled | docs only | Counted over the data that came back, and that is what the bucket is charged |
| Cost of `pageInfo`, `totalCount`, plain lists, `__typename` | Approximate | | The docs don't say. Connection-level fields are charged once, plain lists like one object, `__typename` free |
| The docs' own sample response | Approximate | check | Jobber's "Response structure" sample prices `{ account { id name } }` at 1 point; the documented formula gives 3. The twin follows the formula |
| 2,500 requests per 5 minutes DDoS guard | Via faults | | Use a fault rule with status 429 |
| Mutations | Not yet | | Roadmap v0.1 |
| Webhooks (HMAC-SHA256 signed) | Not yet | | Roadmap v0.2 |
| OAuth 2.0 | Not yet | | Any bearer token is accepted |

[qbo-customer]: https://developer.intuit.com/app/developer/qbo/docs/api/accounting/all-entities/customer
[qbo-errors]: https://developer.intuit.com/app/developer/qbo/docs/develop/troubleshooting/error-codes
[qbo-limits]: https://developer.intuit.com/app/developer/qbo/docs/learn/limits-and-throttles
[qbo-rest]: https://developer.intuit.com/app/developer/qbo/docs/learn/rest-api-features
