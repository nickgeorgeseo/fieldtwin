/**
 * The client's one error, in a file of its own so client.ts and client-oauth.ts can both throw it without importing
 * each other, and the one way they read a JSON answer.
 */

/** A request the twin refused, with its HTTP status and its own explanation as the message. */
export class TwinError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "TwinError";
  }
}

/**
 * An answer read as JSON. A dev server on the wrong port can answer 200 with a page on every path; say which request
 * got what, not "Unexpected token '<'".
 */
export function parseAnswer<T>(text: string, request: string, status: number): T {
  try {
    return JSON.parse(text) as T;
  } catch {
    const answered = `${request} answered HTTP ${status} with something other than JSON`;
    throw new TwinError(`${answered}: ${text.slice(0, 200)} (is this a twin's address?)`, status);
  }
}
