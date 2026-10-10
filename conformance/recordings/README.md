# Recordings

What each conformance case observed against a real vendor sandbox, written by `npm run conformance:record`: `quickbooks.json` and `jobber.json`. Their shape, with illustrative values:

```json
{
  "recordedAt": "2026-10-12T15:04:05.000Z",
  "target": "QuickBooks Online sandbox company",
  "cases": {
    "read-missing-entity": { "status": 400, "faultKey": "Fault", "faultType": "ValidationFault", "code": "610" }
  }
}
```

Observations only: statuses, codes, shapes, and yes-or-no facts. Never tokens, Ids, names, or any other data from the account. Nothing has been recorded yet; see [../README.md](../README.md) for how.
