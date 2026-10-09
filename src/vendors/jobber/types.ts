/** Jobber records as the twin stores them. Shapes follow the public GraphQL schema (camelCase). */

export interface JobberClient {
  id: string; // an EncodedId, see encodeId()
  firstName: string;
  lastName: string;
  companyName: string | null;
  emails: { address: string; primary: boolean }[];
  phones: { number: string; primary: boolean }[];
  createdAt: string;
}

export interface JobberState {
  account: { id: string; name: string };
  clients: Map<string, JobberClient>;
  clientOrder: string[]; // insertion order, so pagination is stable
}

export type JobberEventData =
  | { type: "AccountCreated"; account: { id: string; name: string } }
  | { type: "ClientCreated"; client: JobberClient };

/**
 * Jobber ids are opaque strings. The twin makes them the same way Jobber appears to:
 * base64 of a global id like "gid://Jobber/Client/42". Clients must treat them as opaque either way.
 */
export function encodeId(type: string, n: number): string {
  return Buffer.from(`gid://Jobber/${type}/${n}`).toString("base64");
}
