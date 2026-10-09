/** Jobber records as the twin stores them. Shapes follow the public GraphQL schema (camelCase). */

export interface JobberClient {
  id: string; // an EncodedId, see encoded-id.ts
  firstName: string;
  lastName: string;
  companyName: string | null;
  emails: { address: string; primary: boolean }[];
  phones: { number: string; primary: boolean }[];
  createdAt: string;
}

/** Jobber's `Client.name`: the company name for a business client, otherwise the person's name. */
export function clientName(client: JobberClient): string {
  return client.companyName ?? `${client.firstName} ${client.lastName}`;
}

export interface JobberState {
  account: { id: string; name: string };
  clients: Map<string, JobberClient>;
  clientOrder: string[]; // insertion order, so pagination is stable
}
