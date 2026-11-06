import { shown } from "../../core/request-body.ts";

/**
 * Jobber's EncodedId: "a base64-encoded string that uniquely identifies that record. For example, a client ID of
 * 'Z2lkOi8vSm9iYmVyL0NsaWVudC8xMTkxOTUzNDA' decodes to gid://Jobber/Client/119195340."
 * https://developer.getjobber.com/docs (Object IDs)
 *
 * The twin makes ids exactly that way. Callers should still treat them as opaque strings.
 * Note: Node pads base64 with "=", and the documented example has no padding. Jobber's own examples
 * disagree with each other on this ("MTIzNDU=" is padded), so FIDELITY.md lists padding as unconfirmed.
 */
export function encodeId(type: string, n: number): string {
  return Buffer.from(`gid://Jobber/${type}/${n}`).toString("base64");
}

/**
 * The record type and number inside an id the twin made, or undefined for anything else. The number must be
 * written the way the twin writes it: `Client/01` is no id the twin made, so it resolves to null like any unknown
 * id rather than finding Client 1 and answering with an id the caller never sent.
 */
export function decodeId(id: string): { type: string; n: number } | undefined {
  const match = /^gid:\/\/Jobber\/(\w+)\/(0|[1-9]\d*)$/.exec(Buffer.from(id, "base64").toString());
  return match ? { type: match[1]!, n: Number(match[2]) } : undefined;
}

/** The id in the twin's own spelling, so a lookup finds the record whether the caller kept the base64 padding or not. */
export function canonicalId(id: string): string {
  const decoded = decodeId(id);
  return decoded ? encodeId(decoded.type, decoded.n) : id;
}

/**
 * Whether a value is shaped like an EncodedId at all: a non-empty base64 string. Jobber rejects values that
 * are not (its docs show "'1' is not a valid EncodedId"); a well-formed id that matches no record is not an
 * error, it just resolves to null.
 */
export function isEncodedId(value: unknown): value is string {
  return typeof value === "string" && /^[A-Za-z0-9+/]+={0,2}$/.test(value) && value.length % 4 !== 1;
}

export function invalidEncodedIdMessage(value: unknown): string {
  return `'${printable(value)}' is not a valid EncodedId`;
}

/**
 * The value as String() writes it, which is how the error reads for a plain value. A client's JSON can hold values
 * String() throws on (an object whose toString isn't a function, a list nested thousands deep), and those still
 * deserve the error, not a 500, so they're shown as JSON, or named when they're too deep for that.
 */
function printable(value: unknown): string {
  try {
    return String(value);
  } catch {
    return shown(value);
  }
}

/** The next free number for a record type, given the ids already used: one more than the highest. */
export function nextIdNumber(ids: Iterable<string>, type: string): number {
  let highest = 0;
  for (const id of ids) {
    const decoded = decodeId(id);
    if (decoded?.type === type) highest = Math.max(highest, decoded.n);
  }
  return highest + 1;
}
