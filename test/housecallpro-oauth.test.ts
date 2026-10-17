import { describe, expect, it } from "vitest";
import { setup } from "./helpers.ts";

/** OAuth 2.0 for integration partners: https://docs.housecallpro.com/docs/housecall-public-api/b87d37ae48a0d-authentication */

const CLIENT = { id: "hcp-test-app", secret: "hcp-test-secret", redirectUri: "https://app.example.com/auth/housecall/callback" };
const DAY = 86_400_000;
const INVALID_GRANT =
  "The provided authorization grant is invalid, expired, revoked, does not match the redirection URI used in the authorization request, or was issued to another client.";
type Harness = ReturnType<typeof setup>;

async function authorize(harness: Harness, params: Record<string, string> = {}) {
  const query = new URLSearchParams({
    response_type: "code",
    client_id: CLIENT.id,
    redirect_uri: CLIENT.redirectUri,
    scope: "public",
    ...params,
  });
  return harness.app.request(`/housecallpro/oauth/authorize?${query}`);
}

const codeFrom = (response: Response) => new URL(response.headers.get("Location")!).searchParams.get("code")!;

/** The token request as the docs show it: a JSON body with the app's credentials in it. */
async function token(harness: Harness, body: Record<string, string>) {
  return harness.app.request("/housecallpro/oauth/token", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ client_id: CLIENT.id, client_secret: CLIENT.secret, redirect_uri: CLIENT.redirectUri, ...body }),
  });
}

async function connect(harness: Harness) {
  const code = codeFrom(await authorize(harness));
  return (await token(harness, { grant_type: "authorization_code", code })).json();
}

const companyAs = (harness: Harness, accessToken: string) =>
  harness.app.request("/housecallpro/company", { headers: { Authorization: `Bearer ${accessToken}` } });

describe("Housecall Pro OAuth twin", () => {
  it("approves an authorization request and redirects back to the callback with the code", async () => {
    const response = await authorize(setup(), { state: "xyz" });
    expect(response.status).toBe(302);
    const location = new URL(response.headers.get("Location")!);
    expect(`${location.origin}${location.pathname}`).toBe(CLIENT.redirectUri);
    expect(location.searchParams.get("code")).toBeTruthy();
    expect(location.searchParams.get("state")).toBe("xyz");
  });

  it("exchanges the code for tokens in the documented response shape, good for 30 days", async () => {
    const harness = setup();
    const tokens = await connect(harness);
    expect(tokens).toEqual({
      access_token: expect.any(String),
      token_type: "Bearer",
      expires_in: 2_592_000,
      refresh_token: expect.any(String),
      scope: "public",
      created_at: Date.parse("2026-07-13T11:00:00Z") / 1000,
    });
  });

  it("takes the token request as a form too, as OAuth libraries send it", async () => {
    const harness = setup();
    const code = codeFrom(await authorize(harness));
    const form = {
      client_id: CLIENT.id,
      client_secret: CLIENT.secret,
      grant_type: "authorization_code",
      code,
      redirect_uri: CLIENT.redirectUri,
    };
    const response = await harness.app.request("/housecallpro/oauth/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams(form).toString(),
    });
    expect(response.status).toBe(200);
  });

  it("lets the access token call the API in oauth mode, until it expires 30 days later", async () => {
    const harness = setup(42, { auth: "oauth" });
    const { access_token } = await connect(harness);
    expect((await companyAs(harness, access_token)).status).toBe(200);
    harness.twin.clock.advance(30 * DAY);
    const expired = await companyAs(harness, access_token);
    expect(expired.status).toBe(401);
    expect((await expired.json()).message).toMatch(/expired/);
  });

  it("refreshes an access token, and the old refresh token stops working", async () => {
    const harness = setup(42, { auth: "oauth" });
    const first = await connect(harness);
    const refreshed = await (await token(harness, { grant_type: "refresh_token", refresh_token: first.refresh_token })).json();
    expect(refreshed.access_token).not.toBe(first.access_token);
    expect((await companyAs(harness, refreshed.access_token)).status).toBe(200);

    const again = await token(harness, { grant_type: "refresh_token", refresh_token: first.refresh_token });
    expect(again.status).toBe(400);
    expect(await again.json()).toEqual({ error: "invalid_grant", error_description: INVALID_GRANT });
  });

  it("answers a used code, or one sent with another redirect URI, with the documented invalid_grant", async () => {
    const harness = setup();
    const code = codeFrom(await authorize(harness));
    const wrongRedirect = await token(harness, {
      grant_type: "authorization_code",
      code,
      redirect_uri: "https://elsewhere.example.com/cb",
    });
    expect(wrongRedirect.status).toBe(400);
    expect(await wrongRedirect.json()).toEqual({ error: "invalid_grant", error_description: INVALID_GRANT });

    const fresh = codeFrom(await authorize(harness));
    expect((await token(harness, { grant_type: "authorization_code", code: fresh })).status).toBe(200);
    expect((await token(harness, { grant_type: "authorization_code", code: fresh })).status).toBe(400);
  });

  it("refuses a token request without the app's credentials, or with a grant type it doesn't know", async () => {
    const harness = setup();
    const noSecret = await token(harness, { grant_type: "authorization_code", code: "x", client_secret: "" });
    expect(noSecret.status).toBe(401);
    expect((await noSecret.json()).error).toBe("invalid_client");
    const password = await token(harness, { grant_type: "password" });
    expect(password.status).toBe(400);
    expect((await password.json()).error).toBe("unsupported_grant_type");
  });

  it("refuses an authorization request without a code response type, client, or redirect URI", async () => {
    const harness = setup();
    const response = await authorize(harness, { redirect_uri: "" });
    expect(response.status).toBe(400);
    expect((await response.json()).error).toBe("invalid_request");
  });
});
