import type { OAuthPolicy } from "../../core/oauth.ts";

/**
 * Housecall Pro's OAuth 2.0 server, for integration partners:
 * https://docs.housecallpro.com/docs/housecall-public-api/b87d37ae48a0d-authentication
 */
export const HCP_OAUTH_POLICY: OAuthPolicy = {
  // "expires_in represents the token lifetime in seconds": 2592000 in the code exchange sample, 2629745 in the
  // refresh one. The twin takes the shorter, 30 days, so a client never counts on a token outliving the real one.
  accessTokenSeconds: 2_592_000,
  // Not documented. Ten minutes, as Jobber and the OAuth spec's advice ("a maximum authorization code lifetime of
  // 10 minutes") have it (FIDELITY.md).
  authorizationCodeSeconds: 600,
  refreshTokenSeconds: null, // the docs give refresh tokens no lifetime
  rollingRefreshExpiry: false,
  // The docs don't say whether a refresh returns a new refresh token. The twin rotates them, the stricter reading:
  // code that stores the refresh token it gets back works either way, and code that doesn't finds out here.
  rotateRefreshTokens: true,
};
