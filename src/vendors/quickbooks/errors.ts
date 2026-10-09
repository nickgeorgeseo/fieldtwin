/**
 * QuickBooks Online error bodies. Every error QuickBooks returns is wrapped in a "Fault".
 * Error codes used here are listed in FIDELITY.md with their verification status.
 */

export interface QboFault {
  Fault: { Error: { Message: string; Detail: string; code: string }[]; type: string };
  time: string;
}

export function qboFault(code: string, message: string, detail: string, now: string, type = "ValidationFault"): QboFault {
  return { Fault: { Error: [{ Message: message, Detail: detail, code }], type }, time: now };
}

export const qboErrors = {
  staleObject: (id: string, now: string) =>
    qboFault("5010", "Stale Object Error", `Stale Object Error : You and another user were working on the same thing. Customer Id=${id}`, now),

  notFound: (entity: string, id: string, now: string) =>
    qboFault("610", "Object Not Found", `Object Not Found : Something you're trying to use has been made inactive. Check the fields with accounts, customers, items, vendors or employees. ${entity} Id=${id}`, now),

  duplicateName: (name: string, now: string) =>
    qboFault("6240", "Duplicate Name Exists Error", `The name supplied already exists. : ${name}`, now),

  missingField: (field: string, now: string) =>
    qboFault("2020", "Required param missing, need to supply the required value for the API", `Required parameter ${field} is missing in the request`, now),

  badQuery: (detail: string, now: string) =>
    qboFault("4000", "Error parsing query", `QueryParserError: ${detail}`, now),

  notAuthenticated: (now: string) =>
    qboFault("3200", "AuthenticationFailed", "Missing or malformed Authorization: Bearer header", now, "AuthenticationFault"),

  wrongRealm: (realmId: string, now: string) =>
    qboFault("3200", "AuthenticationFailed", `This twin only serves realm ${realmId}`, now, "AuthenticationFault"),
};
