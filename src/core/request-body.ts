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
  try {
    const fields = Object.entries(await c.req.parseBody()).filter((entry): entry is [string, string] => typeof entry[1] === "string");
    return { form: Object.fromEntries(fields) };
  } catch {
    return { problem: `The request body isn't a form the twin can read. Send it as ${formEncoded}.` };
  }
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
