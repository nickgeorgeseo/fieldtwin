import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { setup } from "./helpers.ts";

/**
 * App authorization: https://developer.getjobber.com/docs/building_your_app/app_authorization/
 * Refresh token rotation: https://developer.getjobber.com/docs/building_your_app/refresh_token_rotation/
 */

const CLIENT = { id: "jobber-test-app", secret: "jobber-test-secret", redirectUri: "https://app.example.com/jobber/callback" };
const HOUR = 3_600_000;
type Harness = ReturnType<typeof setup>;

async function authorize(harness: Harness, params: Record<string, string> = {}) {
  const query = new URLSearchParams({
    response_type: "code",
    client_id: CLIENT.id,
    redirect_uri: CLIENT.redirectUri,
    state: "xyz",
    ...params,
  });
  return harness.app.request(`/api/oauth/authorize?${query}`);
}

const codeFrom = (response: Response) => new URL(response.headers.get("Location")!).searchParams.get("code")!;

async function token(harness: Harness, form: Record<string, string>) {
  return harness.app.request("/api/oauth/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: CLIENT.id, client_secret: CLIENT.secret, ...form }).toString(),
  });
}

async function connect(harness: Harness) {
  const code = codeFrom(await authorize(harness));
  return (await token(harness, { grant_type: "authorization_code", code, redirect_uri: CLIENT.redirectUri })).json();
}

const graphqlAs = (harness: Harness, accessToken: string, query = "{ account { name } }") =>
  harness.app.request("/api/graphql", {
    method: "POST",
    headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json", "X-JOBBER-GRAPHQL-VERSION": "2025-04-16" },
    body: JSON.stringify({ query }),
  });

const jwtPayload = (jwt: string) => JSON.parse(Buffer.from(jwt.split(".")[1]!, "base64url").toString());

describe("Jobber OAuth twin", () => {
  it("approves an authorization request and redirects back with the code and state", async () => {
    const response = await authorize(setup());
    expect(response.status).toBe(302);
    const location = new URL(response.headers.get("Location")!);
    expect(`${location.origin}${location.pathname}`).toBe(CLIENT.redirectUri);
    expect(location.searchParams.get("code")).toBeTruthy();
    expect(location.searchParams.get("state")).toBe("xyz");
  });

  it("exchanges the code for a JWT access token carrying its expiry, in the documented response shape", async () => {
    const harness = setup();
    const tokens = await connect(harness);
    expect(tokens).toEqual({ access_token: expect.any(String), refresh_token: expect.any(String), token_type: "Bearer", expires_in: 3600 });

    const [header] = tokens.access_token.split(".");
    expect(JSON.parse(Buffer.from(header, "base64url").toString())).toEqual({ typ: "JWT", alg: "HS256" });
    const payload = jwtPayload(tokens.access_token);
    expect(payload.exp - payload.iat).toBe(3600);
    expect(payload.exp * 1000).toBe(harness.twin.clock.nowMs() + HOUR);
  });

  it("requires the PKCE verifier when the authorization used a challenge, answering 400 invalid_grant otherwise", async () => {
    const harness = setup();
    const verifier = "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk-twin-verifier";
    const challenge = createHash("sha256").update(verifier).digest("base64url");
    const pkce = { code_challenge: challenge, code_challenge_method: "S256" };

    const wrong = await token(harness, {
      grant_type: "authorization_code",
      code: codeFrom(await authorize(harness, pkce)),
      redirect_uri: CLIENT.redirectUri,
      code_verifier: "nope",
    });
    expect(wrong.status).toBe(400);
    expect((await wrong.json()).error).toBe("invalid_grant");

    const right = await token(harness, {
      grant_type: "authorization_code",
      code: codeFrom(await authorize(harness, pkce)),
      redirect_uri: CLIENT.redirectUri,
      code_verifier: verifier,
    });
    expect(right.status).toBe(200);
  });

  it("lets an authorization code expire after 10 minutes of twin time", async () => {
    const harness = setup();
    const code = codeFrom(await authorize(harness));
    harness.twin.clock.advance(10 * 60_000);
    expect((await token(harness, { grant_type: "authorization_code", code, redirect_uri: CLIENT.redirectUri })).status).toBe(400);
  });

  it("rotates refresh tokens: the old one fails at once with the documented message", async () => {
    const harness = setup();
    const first = await connect(harness);
    const second = await (await token(harness, { grant_type: "refresh_token", refresh_token: first.refresh_token })).json();
    expect(second.refresh_token).not.toBe(first.refresh_token);

    const reused = await token(harness, { grant_type: "refresh_token", refresh_token: first.refresh_token });
    expect(reused.status).toBe(400);
    expect((await reused.json()).error_description).toBe("The provided refresh token is not valid.");
  });

  it("needs the client secret", async () => {
    const harness = setup();
    const response = await harness.app.request("/api/oauth/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ client_id: CLIENT.id, grant_type: "refresh_token", refresh_token: "x" }).toString(),
    });
    expect(response.status).toBe(401);
  });
});

describe("Jobber API with real token checks (auth: oauth)", () => {
  it("answers 401 for a token it never issued, and for one that has expired", async () => {
    const harness = setup(42, { auth: "oauth" });
    expect((await graphqlAs(harness, "made-up")).status).toBe(401);

    const tokens = await connect(harness);
    expect((await graphqlAs(harness, tokens.access_token)).status).toBe(200);
    harness.twin.clock.advance(HOUR);
    const expired = await graphqlAs(harness, tokens.access_token);
    expect(expired.status).toBe(401);
    expect(await expired.json()).toEqual({ message: "Invalid Token Error" });
  });

  it("keeps one cost budget per app, so refreshing a token doesn't refill it", async () => {
    const harness = setup(42, { auth: "oauth" });
    const first = await connect(harness);
    const expensive = "{ clients(first: 1000) { nodes { emails { address } phones { number } } } }";
    await graphqlAs(harness, first.access_token, expensive);

    const refreshed = await (await token(harness, { grant_type: "refresh_token", refresh_token: first.refresh_token })).json();
    const body = await (await graphqlAs(harness, refreshed.access_token, "{ account { name } }")).json();
    expect(body.extensions.cost.throttleStatus.currentlyAvailable).toBeLessThan(10_000 - 2);
  });
});
