/**
 * Shared vocabulary for the whole project. If you are new here, read this file first.
 */

/** Every vendor twin has a short name, used in URLs, logs, and fault rules. */
export type VendorName = "quickbooks" | "jobber";

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
  data: unknown; // shape depends on vendor + type; each vendor's events.ts documents it
}

/** What vendor code hands to twin.record(). The twin fills in seq, at, and source. */
export type NewEvent = Pick<TwinEvent, "vendor" | "type" | "data">;

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
  rate: number; // share of matching requests affected, 0 to 1
  effect: {
    status?: number; // respond with this HTTP status instead of calling the twin
    latencyMs?: number; // wait this long before answering
    message?: string; // error message, rendered in the vendor's own error format
  };
}
