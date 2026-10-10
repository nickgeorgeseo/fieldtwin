import { createHash } from "node:crypto";

/**
 * A UUID-shaped id that is the same every time for the same text. For ids a vendor assigns that the twin has no
 * registry or randomness for, like Jobber's webhook `appId`: derived, never drawn, so runs stay reproducible.
 */
export function stableUuid(text: string): string {
  const hex = createHash("sha256").update(text).digest("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}
