import type { Context } from "hono";

/**
 * Reading what a client sent without letting a malformed body become a 500. These return what was wrong, worded
 * so a developer can fix the request; each vendor answers it in its own error format.
 */

/** A JSON.parse reviver. `context.source` is the value's text as sent (Node 22 and up pass it for numbers). */
export type JsonReviver = (key: string, value: unknown, context?: { source?: string }) => unknown;

/**
 * The body as a JSON object, or what's wrong with it. `example` shows the shape the endpoint expects; `reviver`, if
 * given, reads each value as JSON.parse's does. A reviver recurses, so it runs out of stack on nesting a plain
 * JSON.parse still reads; such a body is read without it, so the vendor still answers with what was wrong.
 */
export async function readJsonObject(
  c: Context,
  example: string,
  reviver?: JsonReviver,
): Promise<{ body: Record<string, unknown> } | { problem: string }> {
  const text = await c.req.text();
  let body: unknown;
  try {
    try {
      body = JSON.parse(text, reviver);
    } catch (error) {
      if (!reviver || !(error instanceof RangeError)) throw error;
      body = JSON.parse(text);
    }
  } catch (error) {
    return { problem: `The request body isn't valid JSON (${(error as Error).message}). Send a JSON object, like ${example}.` };
  }
  if (!isObject(body)) return { problem: `The request body must be a JSON object, like ${example}.` };
  return { body };
}

/** An OAuth request's form fields, or what's wrong with the body. OAuth 2.0 sends forms, never JSON. */
export async function readForm(c: Context): Promise<{ form: Record<string, string> } | { problem: string }> {
  const formEncoded = "application/x-www-form-urlencoded";
  if (!/application\/x-www-form-urlencoded|multipart\/form-data/i.test(c.req.header("Content-Type") ?? "")) {
    return { problem: `Send the request body as ${formEncoded}, as OAuth 2.0 requires.` };
  }
  let body: Record<string, unknown>;
  try {
    body = await c.req.parseBody({ all: true }); // a field sent twice comes back as an array
  } catch {
    return { problem: `The request body isn't a form the twin can read. Send it as ${formEncoded}.` };
  }
  const repeated = Object.keys(body).find((name) => Array.isArray(body[name]));
  if (repeated) return { problem: repeatedProblem(repeated) };
  const fields = Object.entries(body).filter((entry): entry is [string, string] => typeof entry[1] === "string");
  return { form: Object.fromEntries(fields) };
}

/**
 * A query parameter sent more than once, if any. RFC 6749 3.1 says request parameters "MUST NOT be included more
 * than once", and a request that does is invalid_request (4.1.2.1): otherwise which value counts is up to the server.
 */
export function repeatedQueryParameter(c: Context): { name: string; problem: string } | undefined {
  const name = Object.entries(c.req.queries()).find(([, values]) => values.length > 1)?.[0];
  return name === undefined ? undefined : { name, problem: repeatedProblem(name) };
}

const repeatedProblem = (name: string) => `${name} was sent more than once. Send each parameter once, as OAuth 2.0 requires.`;

/**
 * The token request parameter its grant needs but didn't get, if any. RFC 6749 5.2 answers a missing parameter
 * with invalid_request, keeping unsupported_grant_type and invalid_grant for values that were sent.
 */
export function missingGrantParameter(field: (name: string) => string): string | undefined {
  const grantType = field("grant_type");
  if (!grantType) return "grant_type is required: send authorization_code or refresh_token.";
  const needs = grantType === "authorization_code" ? "code" : grantType === "refresh_token" ? "refresh_token" : undefined;
  return needs && !field(needs) ? `${needs} is required with grant_type=${grantType}.` : undefined;
}

/**
 * What's wrong with an OAuth redirect_uri, if anything: it must be an absolute URL to send the browser back to, and
 * "MUST NOT include a fragment component" (RFC 6749 3.1.2), since the code goes in the query.
 */
export function redirectUriProblem(redirectUri: string): string | undefined {
  if (!URL.canParse(redirectUri)) {
    return `redirect_uri must be an absolute URL, like http://localhost:3000/callback, not "${redirectUri}".`;
  }
  if (redirectUri.includes("#")) return `redirect_uri must not include a fragment (#...): send "${redirectUri.split("#")[0]}".`;
  return undefined;
}

/**
 * A value a client sent, as JSON, for an error message about it. JSON.parse reads lists nested far deeper than
 * JSON.stringify can write back, so a value too deep to write is named instead, and the request is still a 4xx.
 */
export function shown(value: unknown): string {
  try {
    return JSON.stringify(value) ?? String(value);
  } catch {
    return `${Array.isArray(value) ? "a list" : "an object"} nested too deeply to show`;
  }
}

export function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
