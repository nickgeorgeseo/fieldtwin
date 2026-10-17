import { type BearerCheck, checkBearer } from "../../core/auth.ts";
import type { Twin } from "../../core/twin.ts";
import { HCP_OAUTH_POLICY } from "./oauth.ts";

/**
 * Housecall Pro takes two kinds of credential in the Authorization header, and "the headers must follow these exact
 * formats": `Token <API key>` for a Pro's own API key, `Bearer <access token>` for an integration partner's OAuth app.
 * https://docs.housecallpro.com/docs/housecall-public-api/b87d37ae48a0d-authentication
 *
 * A Pro makes API keys in their Housecall Pro settings, which the twin doesn't have, so it can't tell a real key from
 * a made-up one: it takes any key, in either auth mode (FIDELITY.md). Access tokens are checked as every vendor's are:
 * any token in any-token mode, only the twin's own in oauth mode.
 */
export function checkCredentials(twin: Twin, authorization: string | undefined): BearerCheck {
  const apiKey = /^Token (\S+)$/.exec(authorization ?? "")?.[1];
  if (apiKey) return { app: `key:${apiKey}` };
  return checkBearer(twin, "housecallpro", HCP_OAUTH_POLICY, authorization);
}

export const AUTH_PROBLEMS = {
  missing: "Send an Authorization header: Token <API key>, or Bearer <access token> for an OAuth app.",
  unknown: "Access token invalid. Get one from the OAuth token endpoint, or send an API key as Token <API key>.",
  expired: "Access token expired. Use your refresh token to get a new one.",
  revoked: "Access token revoked. The Pro must authorize the app again.",
};
