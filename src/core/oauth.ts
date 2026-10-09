import { createHash } from "node:crypto";
import type { SeededRandom } from "./random.ts";

/**
 * A twin OAuth 2.0 authorization server: the authorization code grant, refresh tokens, and PKCE.
 * Each vendor runs one with its own documented policy (token lifetimes, whether refresh tokens rotate)
 * and its own endpoints and response shapes; see vendors/<name>/oauth.ts.
 *
 * There is no user to ask, so every authorization request is approved at once. Everything else follows the
 * spec and the vendors' docs: codes are single-use and short-lived, access tokens expire on twin time,
 * refresh tokens rotate or roll, and revoking a token ends the whole connection.
 *
 * Grants are request bookkeeping, not business state, so they live outside the event log (ARCHITECTURE.md):
 * they survive reset and rewind, the way your app's connection survives changes to the data.
 * Tokens come from a SeededRandom, so the same requests issue the same tokens.
 */

export interface OAuthPolicy {
  accessTokenSeconds: number;
  authorizationCodeSeconds: number;
  refreshTokenSeconds: number | null; // null: refresh tokens don't expire on their own
  rollingRefreshExpiry: boolean; // each use pushes the refresh token's expiry out again
  rotateRefreshTokens: boolean; // each use issues a new refresh token and invalidates the old one
  formatAccessToken?: (claims: AccessTokenClaims) => string; // e.g. Jobber's JWTs; opaque by default
}

export interface AccessTokenClaims {
  clientId: string;
  grantId: string;
  tokenId: string; // unique per token
  issuedMs: number;
  expiresMs: number;
}

export interface TokenSet {
  accessToken: string;
  accessExpiresMs: number;
  refreshToken: string;
  refreshExpiresMs: number | null;
}

export interface OAuthError {
  error: "invalid_request" | "invalid_grant" | "invalid_client" | "unsupported_grant_type";
  description: string;
}

export interface AuthorizationRequest {
  clientId: string;
  redirectUri: string;
  codeChallenge?: string;
  codeChallengeMethod?: string;
}

interface Code extends AuthorizationRequest {
  expiresMs: number;
  used: boolean;
}

interface Issued {
  clientId: string;
  grantId: string;
  expiresMs: number | null;
}

export class OAuthServer {
  private codes = new Map<string, Code>();
  private accessTokens = new Map<string, Issued>();
  private refreshTokens = new Map<string, Issued>();
  private revokedGrants = new Set<string>();
  private grantCount = 0;

  constructor(
    readonly policy: OAuthPolicy,
    private readonly random: SeededRandom,
  ) {}

  /** Approve an authorization request and return the code to send back to the redirect URI. */
  authorize(request: AuthorizationRequest, nowMs: number): string | OAuthError {
    if (request.codeChallenge && request.codeChallengeMethod !== "S256") {
      return { error: "invalid_request", description: "Only the S256 code challenge method is supported." };
    }
    const code = this.token(32);
    this.codes.set(code, { ...request, expiresMs: nowMs + this.policy.authorizationCodeSeconds * 1000, used: false });
    return code;
  }

  /** Exchange an authorization code for tokens. A code works once, before it expires, for the app it was issued to. */
  exchange(request: { clientId: string; code: string; redirectUri: string; codeVerifier?: string }, nowMs: number): TokenSet | OAuthError {
    const code = this.codes.get(request.code);
    if (!code || code.used || nowMs >= code.expiresMs) {
      return { error: "invalid_grant", description: "The authorization code is invalid, expired, or already used." };
    }
    if (code.clientId !== request.clientId || code.redirectUri !== request.redirectUri) {
      return { error: "invalid_grant", description: "The authorization code was issued to a different client or redirect URI." };
    }
    if (code.codeChallenge && !matchesChallenge(request.codeVerifier, code.codeChallenge)) {
      return { error: "invalid_grant", description: "The code_verifier does not match the code_challenge." };
    }
    code.used = true;
    const grantId = `grant-${++this.grantCount}`;
    return this.issue(request.clientId, grantId, this.newRefreshToken(request.clientId, grantId, nowMs), nowMs);
  }

  /** Use a refresh token to get a new access token (and, if the policy rotates them, a new refresh token). */
  refresh(request: { clientId: string; refreshToken: string }, nowMs: number): TokenSet | OAuthError {
    const issued = this.refreshTokens.get(request.refreshToken);
    const expired = issued?.expiresMs !== null && issued?.expiresMs !== undefined && nowMs >= issued.expiresMs;
    if (!issued || expired || this.revokedGrants.has(issued.grantId) || issued.clientId !== request.clientId) {
      return { error: "invalid_grant", description: "The provided refresh token is not valid." };
    }

    let refreshToken = request.refreshToken;
    if (this.policy.rotateRefreshTokens) {
      this.refreshTokens.delete(refreshToken);
      refreshToken = this.newRefreshToken(issued.clientId, issued.grantId, nowMs);
    } else if (this.policy.rollingRefreshExpiry && this.policy.refreshTokenSeconds !== null) {
      issued.expiresMs = nowMs + this.policy.refreshTokenSeconds * 1000;
    }
    return this.issue(issued.clientId, issued.grantId, refreshToken, nowMs);
  }

  /** Who an access token belongs to, or why it doesn't work. */
  verify(accessToken: string, nowMs: number): { clientId: string; grantId: string } | { problem: "unknown" | "expired" | "revoked" } {
    const issued = this.accessTokens.get(accessToken);
    if (!issued) return { problem: "unknown" };
    if (this.revokedGrants.has(issued.grantId)) return { problem: "revoked" };
    if (issued.expiresMs !== null && nowMs >= issued.expiresMs) return { problem: "expired" };
    return { clientId: issued.clientId, grantId: issued.grantId };
  }

  /** Revoke the connection an access or refresh token belongs to. Returns false for a token never issued. */
  revoke(token: string): boolean {
    const issued = this.accessTokens.get(token) ?? this.refreshTokens.get(token);
    if (!issued) return false;
    this.revokedGrants.add(issued.grantId);
    return true;
  }

  private issue(clientId: string, grantId: string, refreshToken: string, nowMs: number): TokenSet {
    const expiresMs = nowMs + this.policy.accessTokenSeconds * 1000;
    const claims: AccessTokenClaims = { clientId, grantId, tokenId: this.token(16), issuedMs: nowMs, expiresMs };
    const accessToken = this.policy.formatAccessToken?.(claims) ?? this.token(64);
    this.accessTokens.set(accessToken, { clientId, grantId, expiresMs });
    return { accessToken, accessExpiresMs: expiresMs, refreshToken, refreshExpiresMs: this.refreshTokens.get(refreshToken)!.expiresMs };
  }

  private newRefreshToken(clientId: string, grantId: string, nowMs: number): string {
    const token = this.token(48);
    const lifetime = this.policy.refreshTokenSeconds;
    this.refreshTokens.set(token, { clientId, grantId, expiresMs: lifetime === null ? null : nowMs + lifetime * 1000 });
    return token;
  }

  /** A random token from the seeded stream: letters and digits. */
  private token(length: number): string {
    const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
    return Array.from({ length }, () => alphabet[this.random.int(0, alphabet.length - 1)]).join("");
  }
}

/** PKCE S256: the challenge is the base64url SHA-256 of the verifier, without padding (RFC 7636). */
function matchesChallenge(verifier: string | undefined, challenge: string): boolean {
  return verifier !== undefined && createHash("sha256").update(verifier).digest("base64url") === challenge;
}
