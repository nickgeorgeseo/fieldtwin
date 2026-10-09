import { clientName, type JobberClient } from "../types.ts";
import type { ResolverContext } from "./context.ts";

/** Client: https://developer.getjobber.com/docs (Important Objects: Client) */
export function clientNode(client: JobberClient, _context: ResolverContext) {
  const primaryEmail = client.emails.find((email) => email.primary) ?? client.emails[0];
  const primaryPhone = client.phones.find((phone) => phone.primary) ?? client.phones[0];
  return {
    ...client,
    name: clientName(client), // "The primary name of the client"
    isCompany: client.companyName !== null,
    email: primaryEmail?.address ?? null, // "The client's primary email address"
    phone: primaryPhone?.number ?? null,
    updatedAt: client.createdAt,
  };
}
