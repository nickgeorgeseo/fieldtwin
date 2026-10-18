/**
 * Housecall Pro error bodies. The reference documents one error schema, ErrorResponse, `{ "error": { "message" } }`,
 * with samples like Lock Job's 404 `{ "error": { "message": "job not found" } }`, and the twin answers every error in
 * it except 401. The only documented 401 body (Get Pipeline Statuses) is `{ "message" }`, so a 401 is that.
 * https://docs.housecallpro.com/docs/housecall-public-api/a4ca20a18010c-housecall-v1-api
 *
 * A few endpoints document other shapes (`{ "message", <field>: ... }` for a 400, an empty object for a 404), so
 * FIDELITY.md marks these to check against a real account.
 */

export interface HcpError {
  error: { message: string };
}

export function hcpError(message: string): HcpError {
  return { error: { message } };
}

export function hcpUnauthorized(message: string): { message: string } {
  return { message };
}

/**
 * "429 responses will include a header (RateLimit-Reset) with the time (in epoch format) that the user rate limit will
 * be reset" (https://docs.housecallpro.com/). The docs give no window, so the twin says a minute after the request,
 * as QuickBooks asks clients to wait, in epoch seconds of twin time (FIDELITY.md).
 */
export function hcpErrorHeaders(status: number, nowMs: number): Record<string, string> {
  return status === 429 ? { "RateLimit-Reset": String(Math.ceil((nowMs + RATE_LIMIT_WINDOW_MS) / 1000)) } : {};
}

const RATE_LIMIT_WINDOW_MS = 60_000;

/** The body an injected fault, or the twin's own trouble, answers with. */
export function hcpErrorForStatus(status: number, message: string): HcpError | { message: string } {
  return status === 401 ? hcpUnauthorized(message) : hcpError(message);
}
