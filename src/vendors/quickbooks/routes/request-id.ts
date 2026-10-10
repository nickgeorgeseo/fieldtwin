import type { Context } from "hono";
import { qboErrors } from "../errors.ts";
import type { QboState } from "../types.ts";
import { asResponse } from "./entity.ts";

/**
 * Request IDs make a write safe to retry: https://developer.intuit.com/app/developer/qbo/docs/learn/learn-basic-field-definitions
 * "If our service receives another request with the same request ID, instead of performing the operation again or
 * returning an error, it can recognize and send the same response for the original request. This prevents
 * duplication." A request ID "must be unique for all requests for a given QuickBooks Online company file" and
 * "can have a maximum of 50 characters".
 *
 * The docs leave open how long QuickBooks remembers a request ID, and whether it replays failed answers too. The
 * twin remembers successful writes until a reset or a rewind undoes them, and lets a failed write be sent again
 * with its request ID, since nothing was written (FIDELITY.md marks both "check").
 */
const REQUEST_ID_MAX_LENGTH = 50;

/**
 * A write's requestid, checked before the write. A repeat gets the first answer again (`answer`); a new one comes
 * back as `requestId`, for the write to record on its event. A write without one gets `{}`.
 */
export function checkRequestId(c: Context, state: QboState, now: string): { requestId?: string } | { answer: Response } {
  const requestId = c.req.query("requestid");
  if (!requestId) return {};
  if (requestId.length > REQUEST_ID_MAX_LENGTH) {
    return { answer: c.json(qboErrors.stringTooLong("requestid", REQUEST_ID_MAX_LENGTH, requestId.length, now), 400) };
  }
  const earlier = state.answered.get(requestId);
  if (earlier) return { answer: c.json({ [earlier.entity]: asResponse(earlier.record), time: earlier.time }) };
  return { requestId };
}
