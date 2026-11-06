import { describe, expect, it } from "vitest";
import { setup } from "./helpers.ts";

/** OAuth 2.0: https://developer.intuit.com/app/developer/qbo/docs/develop/authentication-and-authorization/oauth-2.0 */

const CLIENT = { id: "qbo-test-app", secret: "qbo-test-secret", redirectUri: "https://app.example.com/qbo/callback" };
const basic = (id = CLIENT.id, secret = CLIENT.secret) => `Basic ${Buffer.from(`${id}:${secret}`).toString("base64")}`;
const HOUR = 3_600_000;
type Harness = ReturnType<typeof setup>;

async function authorize(harness: Harness, params: Record<string, string> = {}) {
  const query = new URLSearchParams({
    client_id: CLIENT.id,
    response_type: "code",
    scope: "com.intuit.quickbooks.accounting",
    redirect_uri: CLIENT.redirectUri,
    state: "security_token=138r5719ru3e1",
    ...params,
  });
  return harness.app.request(`/connect/oauth2?${query}`);
}

async function tokenRequest(harness: Harness, form: Record<string, string>, authorization = basic()) {
  return harness.app.request("/oauth2/v1/tokens/bearer", {
    method: "POST",
    headers: { Accept: "application/json", "Content-Type": "application/x-www-form-urlencoded", Authorization: authorization },
    body: new URLSearchParams(form).toString(),
  });
}

async function connect(harness: Harness) {
  const location = new URL((await authorize(harness)).headers.get("Location")!);
  const code = location.searchParams.get("code")!;
  return (await tokenRequest(harness, { grant_type: "authorization_code", code, redirect_uri: CLIENT.redirectUri })).json();
}

const revoke = (harness: Harness, token: string, authorization = basic(), contentType = "application/json") =>
  harness.app.request("/v2/oauth2/tokens/revoke", {
    method: "POST",
    headers: { "Content-Type": contentType, Authorization: authorization },
    body: JSON.stringify({ token }),
  });

const customerAs = (harness: Harness, accessToken: string) =>
  harness.app.request("/v3/company/9341000000000001/customer/1", { headers: { Authorization: `Bearer ${accessToken}` } });

describe("QuickBooks OAuth twin", () => {
  it("approves an authorization request and redirects back with the code, state, and realmId", async () => {
    const response = await authorize(setup());
    expect(response.status).toBe(302);
    const location = new URL(response.headers.get("Location")!);
    expect(`${location.origin}${location.pathname}`).toBe(CLIENT.redirectUri);
    expect(location.searchParams.get("code")).toBeTruthy();
    expect(location.searchParams.get("state")).toBe("security_token=138r5719ru3e1");
    expect(location.searchParams.get("realmId")).toBe("9341000000000001");
  });

  it("redirects with invalid_scope when the accounting scope is missing", async () => {
    const response = await authorize(setup(), { scope: "openid" });
    const location = new URL(response.headers.get("Location")!);
    expect(location.searchParams.get("error")).toBe("invalid_scope");
    expect(location.searchParams.get("state")).toBe("security_token=138r5719ru3e1");
  });

  it("refuses a redirect URI with a fragment, which OAuth forbids, as 400 invalid_request", async () => {
    const response = await authorize(setup(), { redirect_uri: `${CLIENT.redirectUri}#section` });
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: "invalid_request", error_description: expect.stringMatching(/fragment/) });
  });

  it("redirects with invalid_request when response_type is missing, keeping unsupported_response_type for another value", async () => {
    const harness = setup();
    const missing = new URL((await authorize(harness, { response_type: "" })).headers.get("Location")!);
    expect(missing.searchParams.get("error")).toBe("invalid_request");
    const token = new URL((await authorize(harness, { response_type: "token" })).headers.get("Location")!);
    expect(token.searchParams.get("error")).toBe("unsupported_response_type");
  });

  it("answers a token request missing grant_type, or a code grant missing its code, with 400 invalid_request naming it", async () => {
    const harness = setup();
    const noGrantType = await tokenRequest(harness, { code: "x", redirect_uri: CLIENT.redirectUri });
    expect(await noGrantType.json()).toEqual({
      error: "invalid_request",
      error_description: expect.stringMatching(/^grant_type is required/),
    });
    const noCode = await tokenRequest(harness, { grant_type: "authorization_code", redirect_uri: CLIENT.redirectUri });
    expect(noCode.status).toBe(400);
    expect(await noCode.json()).toEqual({ error: "invalid_request", error_description: expect.stringMatching(/^code is required/) });
  });

  it("exchanges the code for tokens in the documented response shape", async () => {
    const tokens = await connect(setup());
    expect(tokens).toEqual({
      token_type: "bearer",
      expires_in: 3600,
      refresh_token: expect.any(String),
      x_refresh_token_expires_in: 8_640_000,
      access_token: expect.any(String),
    });
  });

  it("accepts a code only once", async () => {
    const harness = setup();
    const code = new URL((await authorize(harness)).headers.get("Location")!).searchParams.get("code")!;
    const form = { grant_type: "authorization_code", code, redirect_uri: CLIENT.redirectUri };
    expect((await tokenRequest(harness, form)).status).toBe(200);
    const again = await tokenRequest(harness, form);
    expect(again.status).toBe(400);
    expect((await again.json()).error).toBe("invalid_grant");
  });

  it("needs the app's credentials as HTTP Basic auth", async () => {
    const harness = setup();
    const response = await tokenRequest(harness, { grant_type: "refresh_token", refresh_token: "x" }, "");
    expect(response.status).toBe(401);
    expect((await response.json()).error).toBe("invalid_client");
  });

  it("form-decodes HTTP Basic credentials, as OAuth libraries encode them, so a client_id like 'dev@example.com' exchanges its code", async () => {
    const harness = setup();
    const clientId = "dev@example.com my app";
    const code = new URL((await authorize(harness, { client_id: clientId })).headers.get("Location")!).searchParams.get("code")!;
    const encoded = basic(new URLSearchParams({ id: clientId }).toString().slice(3), "s%C3%A9cret");
    const response = await tokenRequest(harness, { grant_type: "authorization_code", code, redirect_uri: CLIENT.redirectUri }, encoded);
    expect(response.status).toBe(200);
  });

  it("refreshes an access token, keeping the refresh token as in the documented sample", async () => {
    const harness = setup();
    const first = await connect(harness);
    harness.twin.clock.advance(2 * HOUR);
    const refreshed = await (await tokenRequest(harness, { grant_type: "refresh_token", refresh_token: first.refresh_token })).json();
    expect(refreshed.access_token).not.toBe(first.access_token);
    expect(refreshed.refresh_token).toBe(first.refresh_token);
    expect(refreshed.x_refresh_token_expires_in).toBe(8_640_000); // a rolling 100 days
  });
});

describe("QuickBooks API with real token checks (auth: oauth)", () => {
  it("rejects requests without a token it issued, with 401 AuthenticationFault 3200", async () => {
    const harness = setup(42, { auth: "oauth" });
    const response = await customerAs(harness, "made-up-token");
    expect(response.status).toBe(401);
    expect((await response.json()).Fault).toMatchObject({ type: "AuthenticationFault", Error: [{ code: "3200" }] });
  });

  it("accepts its own access token for 60 minutes of twin time, then needs a refresh", async () => {
    const harness = setup(42, { auth: "oauth" });
    const tokens = await connect(harness);
    expect((await customerAs(harness, tokens.access_token)).status).toBe(200);

    harness.twin.clock.advance(HOUR);
    const expired = await customerAs(harness, tokens.access_token);
    expect(expired.status).toBe(401);
    expect((await expired.json()).Fault.Error[0].Detail).toContain("expired");

    const refreshed = await (await tokenRequest(harness, { grant_type: "refresh_token", refresh_token: tokens.refresh_token })).json();
    expect((await customerAs(harness, refreshed.access_token)).status).toBe(200);
  });

  it("stops accepting tokens once they are revoked", async () => {
    const harness = setup(42, { auth: "oauth" });
    const tokens = await connect(harness);
    expect((await revoke(harness, tokens.refresh_token)).status).toBe(200);
    expect((await customerAs(harness, tokens.access_token)).status).toBe(401);
  });

  it("answers 200 again for a token already revoked, and 400 saying it was never issued for a token the twin never issued", async () => {
    const harness = setup(42, { auth: "oauth" });
    const tokens = await connect(harness);
    expect((await revoke(harness, tokens.refresh_token)).status).toBe(200);
    expect((await revoke(harness, tokens.refresh_token)).status).toBe(200);

    const unknown = await revoke(harness, "never-issued");
    expect(unknown.status).toBe(400);
    expect(await unknown.json()).toEqual({
      error: "invalid_request",
      error_description: expect.stringMatching(/^That token was never issued\./),
    });
  });

  it("refuses to revoke a token for an app it wasn't issued to, and leaves that app connected", async () => {
    const harness = setup(42, { auth: "oauth" });
    const tokens = await connect(harness);
    const other = await revoke(harness, tokens.refresh_token, basic("another-app", "another-secret"));
    expect(other.status).toBe(400);
    expect(await other.json()).toEqual({ error: "invalid_request", error_description: expect.stringMatching(/another app/) });
    expect((await customerAs(harness, tokens.access_token)).status).toBe(200);
  });

  it("reads a revoke body as JSON whatever the case of its media type, as media types are case-insensitive", async () => {
    const harness = setup(42, { auth: "oauth" });
    const tokens = await connect(harness);
    expect((await revoke(harness, tokens.refresh_token, basic(), "APPLICATION/JSON; charset=UTF-8")).status).toBe(200);
    expect((await customerAs(harness, tokens.access_token)).status).toBe(401);
  });

  it("keeps the connection through a reset, the way an app stays connected while data changes", async () => {
    const harness = setup(42, { auth: "oauth" });
    const tokens = await connect(harness);
    harness.twin.reset();
    expect((await customerAs(harness, tokens.access_token)).status).toBe(200);
  });
});
