/**
 * The client's one error, in a file of its own so client.ts and client-oauth.ts can both throw it without importing
 * each other.
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
