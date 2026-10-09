import type { OAuthPolicy } from "./oauth.ts";
import type { Twin } from "./twin.ts";
import type { VendorName } from "./types.ts";

/**
 * The bearer-token check every vendor API runs. Vendors decide what a failure looks like (each has its own
 * 401 body); this decides whether the request may go on, and which app it came from.
 *
 * `app` identifies the caller for per-app bookkeeping such as rate-limit budgets: the OAuth client_id for a
 * token the twin issued (so refreshing a token keeps the same budget), or the raw token in any-token mode.
 */
export type BearerCheck = { app: string } | { problem: "missing" | "unknown" | "expired" | "revoked" };

export function checkBearer(twin: Twin, vendor: VendorName, policy: OAuthPolicy, authorization: string | undefined): BearerCheck {
  const token = /^Bearer (\S+)$/i.exec(authorization ?? "")?.[1];
  if (!token) return { problem: "missing" };

  const verified = twin.oauthServer(vendor, policy).verify(token, twin.clock.nowMs());
  if ("clientId" in verified) return { app: `client:${verified.clientId}` };
  if (twin.authMode === "any-token") return { app: `token:${token}` };
  return { problem: verified.problem };
}
