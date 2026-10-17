import { describe, expect, it } from "vitest";
import { setup } from "./helpers.ts";

describe("Housecall Pro twin: the company", () => {
  it("serves the same business as the other twins at GET /company, under the twin's /housecallpro", async () => {
    const { twin, hcpGet } = setup();
    const response = await hcpGet("/company");
    expect(response.status).toBe(200);
    const company = await response.json();
    expect(company).toMatchObject({
      name: twin.world.company.name,
      address: { city: twin.world.company.city, state: twin.world.company.state, country: "US" },
    });
    expect(company.id).toMatch(/^[0-9a-f-]{36}$/);
  });

  it("names the business's time zone the way the API does, as an IANA zone", async () => {
    const { twin, hcpGet } = setup();
    const company = await (await hcpGet("/company")).json();
    const zone = twin.world.company.state === "TX" ? "America/Chicago" : "America/New_York";
    expect(company.time_zone).toBe(zone);
  });
});

describe("Housecall Pro twin: credentials", () => {
  it("takes a Pro's API key, sent as Authorization: Token <key>", async () => {
    const { app } = setup();
    const response = await app.request("/housecallpro/company", { headers: { Authorization: "Token 0046421dc0ba47ec87bef0c089415380" } });
    expect(response.status).toBe(200);
  });

  it("takes an OAuth access token, sent as Authorization: Bearer <token>", async () => {
    const { app } = setup();
    const response = await app.request("/housecallpro/company", { headers: { Authorization: "Bearer d7f65570a4714ae944fbe5" } });
    expect(response.status).toBe(200);
  });

  it("refuses a request without credentials with 401, saying which two headers work", async () => {
    const { app } = setup();
    const response = await app.request("/housecallpro/company");
    expect(response.status).toBe(401);
    expect((await response.json()).message).toMatch(/Token <API key>.*Bearer <access token>/);
  });

  it("refuses credentials sent in any other format, since the docs say the headers must be exact", async () => {
    const { app } = setup();
    for (const header of ["token 0046421dc0", "0046421dc0", "Token", "bearer d7f65570a4", "BEARER d7f65570a4", "Bearer  d7f65570a4"]) {
      const response = await app.request("/housecallpro/company", { headers: { Authorization: header } });
      expect(response.status, header).toBe(401);
    }
  });

  it("still takes API keys when the twin checks OAuth tokens, since it can't know which keys a Pro made", async () => {
    const { app } = setup(42, { auth: "oauth" });
    const withKey = await app.request("/housecallpro/company", { headers: { Authorization: "Token any-key" } });
    expect(withKey.status).toBe(200);
    const withMadeUpToken = await app.request("/housecallpro/company", { headers: { Authorization: "Bearer made-up" } });
    expect(withMadeUpToken.status).toBe(401);
  });
});

describe("Housecall Pro twin: what it doesn't serve", () => {
  it("answers 501 in Housecall Pro's error format for an endpoint it doesn't model yet, naming what it serves", async () => {
    const { hcpGet } = setup();
    const response = await hcpGet("/leads");
    expect(response.status).toBe(501);
    expect((await response.json()).error.message).toMatch(/doesn't model GET \/leads yet.*company/);
  });

  it("injects a fault in Housecall Pro's error format, without touching the other vendors", async () => {
    const { twin, hcpGet, qboGet } = setup();
    twin.faultRules = [{ name: "outage", vendor: "housecallpro", rate: 1, effect: { status: 503 } }];

    const failed = await hcpGet("/company");
    expect(failed.status).toBe(503);
    expect(failed.headers.get("X-Twin-Fault")).toBe("outage");
    expect(await failed.json()).toEqual({ error: { message: 'Injected by fault rule "outage"' } });

    expect((await qboGet("/customer/1")).status).toBe(200);
  });
});
