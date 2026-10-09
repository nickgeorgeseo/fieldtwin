/**
 * QuickBooks Online error bodies. Every error QuickBooks returns is wrapped in a "Fault".
 * Reference: https://developer.intuit.com/app/developer/qbo/docs/develop/troubleshooting/error-codes
 *
 * That page documents its MESSAGE column as the literal <Message>, so messages here are copied exactly.
 * Its DETAIL column "gives possible solutions"; where it shows a template ("Query Parser Error: XXX") we fill
 * it in, otherwise we use the documented explanation. Real Detail strings may differ (see FIDELITY.md).
 * `element` is "the name of the field associated with the error, if applicable".
 */

export interface QboError {
  Message: string;
  Detail: string;
  code: string;
  element?: string;
}

export type QboFaultType = "ValidationFault" | "SystemFault" | "AuthenticationFault" | "AuthorizationFault" | "SERVICE";

export interface QboFault {
  Fault: { Error: QboError[]; type: QboFaultType };
  time: string;
}

export function qboFault(error: QboError, now: string, type: QboFaultType = "ValidationFault"): QboFault {
  return { Fault: { Error: [error], type }, time: now };
}

export const qboErrors = {
  notFound: (now: string) =>
    qboFault({ code: "610", Message: "Object Not Found", Detail: "The object ID you're requesting doesn't exist." }, now),

  missingField: (field: string, now: string) =>
    qboFault(
      {
        code: "2020",
        Message: "Required param missing, need to supply the required value for the API",
        Detail: `Required parameter ${field} is missing.`,
        element: field,
      },
      now,
    ),

  badQuery: (detail: string, now: string) =>
    qboFault(
      {
        code: "4000",
        Message: "The query cannot be parsed, refer to detailed message for reasons",
        Detail: `Query Parser Error: ${detail}`,
      },
      now,
    ),

  invalidQuery: (detail: string, now: string) =>
    qboFault({ code: "4001", Message: "The query is invalid", Detail: `QueryValidationError: ${detail}` }, now),

  staleObject: (now: string) =>
    qboFault(
      { code: "5010", Message: "Stale Object", Detail: "The requested update is for a stale object. Client needs to refresh the object." },
      now,
    ),

  duplicateName: (existingId: string, now: string) =>
    qboFault(
      {
        code: "6240",
        Message: "Duplicate Name Exists Error",
        Detail: `The specified name already exists. The customer ID is: ${existingId}.`,
        element: "DisplayName",
      },
      now,
    ),

  // 401 with code 3200 is documented for an invalid or expired access token. The Message is the
  // documented 3200 message; the Detail says what to do about it.
  notAuthenticated: (detail: string, now: string) =>
    qboFault({ code: "3200", Message: "ApplicationAuthenticationFailed", Detail: detail }, now, "AuthenticationFault"),

  // 403 with code 3100 is the only documented authorization failure (an AuthorizationFault means the
  // app is not authorized for that resource). The exact Message QuickBooks uses here is unconfirmed.
  notAuthorized: (detail: string, now: string) =>
    qboFault({ code: "3100", Message: "ApplicationAuthorizationFailed", Detail: detail }, now, "AuthorizationFault"),

  wrongRealm: (requestedRealmId: string, servedRealmId: string, now: string) =>
    qboErrors.notAuthorized(`This token is not authorized for company ${requestedRealmId}. The twin serves realm ${servedRealmId}.`, now),

  // Intuit documents only the HTTP 429 status and "wait 60 seconds before retrying":
  // https://developer.intuit.com/app/developer/qbo/docs/learn/limits-and-throttles
  // The body below (code 003001, ThrottleExceeded) is widely reported but not in the docs.
  throttled: (detail: string, now: string) => qboFault({ code: "003001", Message: "ThrottleExceeded", Detail: detail }, now, "SERVICE"),

  serverError: (detail: string, now: string) =>
    qboFault(
      { code: "10000", Message: "An application error has occurred while processing your request.", Detail: detail },
      now,
      "SystemFault",
    ),
};

/** The body an injected fault answers with: the documented error for that status where there is one. */
export function qboErrorForStatus(status: number, detail: string, now: string): QboFault {
  if (status === 401) return qboErrors.notAuthenticated(detail, now);
  if (status === 403) return qboErrors.notAuthorized(detail, now);
  if (status === 429) return qboErrors.throttled(detail, now);
  if (status >= 500) return qboErrors.serverError(detail, now);
  return qboFault({ code: String(status), Message: "Injected fault", Detail: detail }, now);
}
