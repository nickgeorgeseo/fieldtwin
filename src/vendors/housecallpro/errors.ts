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

/** The body an injected fault, or the twin's own trouble, answers with. */
export function hcpErrorForStatus(status: number, message: string): HcpError | { message: string } {
  return status === 401 ? hcpUnauthorized(message) : hcpError(message);
}
