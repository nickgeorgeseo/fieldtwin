import type { ClientErrorStatusCode, ServerErrorStatusCode } from "hono/utils/http-status";

/**
 * Shared vocabulary for the whole project. If you are new here, read this file first.
 */

/**
 * Every vendor twin has a short name, used in URLs, logs, fault rules, and scenarios. Adding a vendor starts here:
 * scenarios, fault rules, and webhook subscriptions accept exactly these names.
 */
export const VENDOR_NAMES = ["quickbooks", "jobber", "housecallpro"] as const;
export type VendorName = (typeof VENDOR_NAMES)[number];

/**
 * Where an event came from.
 *   seed      – created when the twin was reset
 *   scenario  – created by a scenario timeline
 *   api       – caused by the code under test calling a vendor API
 *   control   – caused by a developer using the /_twin control plane
 */
export type EventSource = "seed" | "scenario" | "api" | "control";

/** One fact that happened inside the twin. The event log is a list of these. */
export interface TwinEvent {
  seq: number; // position in the log, starting at 1
  at: string; // twin time (ISO 8601), never wall-clock time
  source: EventSource;
  vendor: VendorName;
  type: string; // past tense, e.g. "CustomerCreated"
  data: unknown; // shape depends on vendor + type; each vendor's events.ts defines it
}

/** What vendor code hands to twin.record(). The twin fills in seq, at, and source. */
export type NewEvent = Pick<TwinEvent, "vendor" | "type" | "data">;

/**
 * How the vendor APIs treat bearer tokens.
 *   any-token – any "Authorization: Bearer ..." works. Quick local use; the default for `npm start`.
 *   oauth     – only access tokens the twin's OAuth server issued, and only until they expire or are revoked.
 */
export type AuthMode = "any-token" | "oauth";

/** A named point in history you can list changes from or rewind to. */
export interface Checkpoint {
  name: string;
  seq: number;
  time: string;
}

/**
 * A rule that makes a vendor API misbehave on purpose, the way real APIs do.
 * Faults are data, not code: vendor twins never know faults exist.
 */
export interface FaultRule {
  name: string;
  vendor: VendorName;
  method?: string; // e.g. "POST". Omit to match any method.
  pathIncludes?: string; // e.g. "/customer". Omit to match any path.
  webhook?: string; // a topic ("INVOICE_UPDATE") or "*": the rule matches webhook deliveries instead of requests
  rate: number; // share of matching requests (or deliveries) affected, 0 to 1
  effect: {
    status?: FaultStatus; // respond with this HTTP error status instead of calling the twin
    latencyMs?: number; // wait this long before answering
    message?: string; // error message, rendered in the vendor's own error format
    lostResponse?: boolean; // do the work first, then answer with `status`: the real answer was lost on its way back
    duplicate?: boolean; // webhook rules: deliver it twice
    delayMs?: number; // webhook rules: deliver it this much twin time late, so later deliveries overtake it
  };
}

/** The HTTP statuses a fault may answer with: Hono's client and server error codes, so no cast is ever needed. */
export type FaultStatus = ClientErrorStatusCode | ServerErrorStatusCode;

const FAULT_STATUSES: readonly FaultStatus[] = [
  400, 401, 402, 403, 404, 405, 406, 407, 408, 409, 410, 411, 412, 413, 414, 415, 416, 417, 418, 421, 422, 423, 424, 425, 426, 428, 429,
  431, 451, 500, 501, 502, 503, 504, 505, 506, 507, 508, 510, 511,
];

export function isFaultStatus(status: number): status is FaultStatus {
  return (FAULT_STATUSES as readonly number[]).includes(status);
}
