# Security

fieldtwin is a local test tool: it imitates vendor APIs over a generated, fake business. It is deliberately easy to drive. By default any bearer token is accepted, and the `/_twin` control plane has no authentication. Treat a running twin like a dev server.

## Using it safely

- **Keep it on your machine.** It listens on 127.0.0.1. Set `FIELDTWIN_HOST` only on a network you trust: anyone who can reach the twin can control it, and a webhook subscription makes it send requests to any URL.
- **Never put real credentials or customer data in it.** It needs neither: the world is generated, and its OAuth servers accept any client id and secret.
- **The conformance recorder is the one part that talks to real vendors.** `npm run conformance:record` reads your sandbox tokens from environment variables, never stores them, refuses production QuickBooks, and saves observations only, with no tokens, Ids, or business data. See [conformance/README.md](conformance/README.md).

## Supported versions

The latest release. fieldtwin is pre-1.0, so fixes go into the next release rather than back into old ones.

## Reporting a vulnerability

Please report it privately through GitHub: the repository's **Security** tab, then **Report a vulnerability**. Don't open a public issue for it.

Include the version or commit, how to reproduce it, and what someone could do with it. Examples of what counts: a way to make the twin act on the host beyond what it documents, a secret it was given showing up where it shouldn't (webhook secrets, for instance, are never shown back), or the recorder leaking a token.

The twin answering differently from the real API is a fidelity bug, not a vulnerability: open an ordinary issue for that (see [CONTRIBUTING.md](CONTRIBUTING.md)).
