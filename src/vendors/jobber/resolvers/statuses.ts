import type { JobberVisit } from "../types.ts";

/**
 * Statuses are derived, not stored: Jobber's visitStatus and jobStatus change as time passes even when
 * nobody edits anything, so the twin works them out from the facts and the twin clock on every read.
 * The enum values aren't in Jobber's public docs; these follow the lowercase style of the documented ones
 * (InvoiceStatusTypeEnum's "voided") and FIDELITY.md marks them "check".
 */

export type VisitStatus = "completed" | "late" | "today" | "upcoming" | "unscheduled";
export type JobStatus = "active" | "archived" | "late" | "requires_invoicing" | "today" | "upcoming" | "unscheduled";

const HOUR = 3_600_000;

/** The calendar date at the business, which is what "today" and "late" mean to a dispatcher. */
export function localDate(ms: number, utcOffsetHours: number): string {
  return new Date(ms + utcOffsetHours * HOUR).toISOString().slice(0, 10);
}

/** A visit is late once its day has passed without it being completed, and on today's board until then. */
export function visitStatus(visit: JobberVisit, nowMs: number, utcOffsetHours: number): VisitStatus {
  if (visit.completedAt) return "completed";
  const visitDay = localDate(Date.parse(visit.startAt), utcOffsetHours);
  const today = localDate(nowMs, utcOffsetHours);
  if (visitDay < today) return "late";
  return visitDay === today ? "today" : "upcoming";
}

/**
 * A job's status follows its visits: finished work needs invoicing until it is invoiced (then it is
 * archived); otherwise the most urgent visit wins, and a job part way through its visits is active.
 */
export function jobStatus(visits: JobberVisit[], invoiced: boolean, nowMs: number, utcOffsetHours: number): JobStatus {
  if (visits.length === 0) return "unscheduled";
  const statuses = visits.map((visit) => visitStatus(visit, nowMs, utcOffsetHours));
  if (statuses.every((status) => status === "completed")) return invoiced ? "archived" : "requires_invoicing";
  if (statuses.includes("late")) return "late";
  if (statuses.includes("today")) return "today";
  return statuses.includes("completed") ? "active" : "upcoming";
}
