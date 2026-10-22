import { Hono } from "hono";
import { describe, expect, it, vi } from "vitest";
import { answerUnexpectedErrors } from "../src/app.ts";
import { setup } from "./helpers.ts";

/**
 * A client bug must come back as an error the client can read, in the vendor's own format, with a 400 that
 * says what was wrong: never a plain-text 500, which SDKs can't parse and retry loops resend forever.
 */

const QBO = "/v3/company/9341000000000001";
const qboRaw = (harness: ReturnType<typeof setup>, path: string, body: string) =>
  harness.app.request(`${QBO}${path}`, {
    method: "POST",
    headers: { Authorization: "Bearer t", "Content-Type": "application/json" },
    body,
  });
const jobberRaw = (harness: ReturnType<typeof setup>, body: string) =>
  harness.app.request("/api/graphql", {
    method: "POST",
    headers: { Authorization: "Bearer t", "Content-Type": "application/json", "X-JOBBER-GRAPHQL-VERSION": "2025-04-16" },
    body,
  });

describe("QuickBooks twin: request bodies it can't use", () => {
  it.each(["/customer", "/invoice", "/payment"])("answers JSON it can't parse, sent to %s, with 2010 and what was wrong", async (path) => {
    const response = await qboRaw(setup(), path, "{not json");
    expect(response.status).toBe(400);
    const { Fault } = await response.json();
    expect(Fault).toMatchObject({
      type: "ValidationFault",
      Error: [{ code: "2010", Message: "Request has invalid or unsupported property" }],
    });
    expect(Fault.Error[0].Detail).toContain("isn't valid JSON");
  });

  it.each(["null", "[]", '"a customer"', ""])("answers a body that isn't a JSON object (%s) with 2010", async (body) => {
    const response = await qboRaw(setup(), "/customer", body);
    expect(response.status).toBe(400);
    expect((await response.json()).Fault.Error[0]).toMatchObject({ code: "2010" });
  });

  it("answers invoice lines that aren't objects with 2010 naming Line", async () => {
    const response = await setup().qboPost("/invoice", { CustomerRef: { value: "1" }, Line: [null] });
    expect(response.status).toBe(400);
    expect((await response.json()).Fault.Error[0]).toMatchObject({ code: "2010", element: "Line" });
  });

  it.each([
    ["Line as an object", { Line: { Amount: 5 } }, "Line"],
    ["a line that is null", { Line: [null] }, "Line"],
    ["LinkedTxn as an object", { Line: [{ Amount: 5, LinkedTxn: { TxnId: "1", TxnType: "Invoice" } }] }, "Line.LinkedTxn"],
  ])("answers a payment with %s with 2010", async (_label, fields, element) => {
    const response = await setup().qboPost("/payment", { CustomerRef: { value: "1" }, TotalAmt: 5, ...fields });
    expect(response.status).toBe(400);
    expect((await response.json()).Fault.Error[0]).toMatchObject({ code: "2010", element });
  });
});

describe("Jobber twin: request bodies it can't use", () => {
  it.each([
    ["JSON it can't parse", "{not json", "isn't valid JSON"],
    ["a body that isn't an object", "null", "JSON object"],
    ["an empty body", "", "isn't valid JSON"],
    ["a query that isn't a string", '{"query": 5}', "query must be a string"],
    ["variables sent as a string", '{"query": "{ account { id } }", "variables": "{}"}', "variables must be a JSON object"],
  ])("answers %s with 400 and a GraphQL error saying what to send", async (_label, body, says) => {
    const response = await jobberRaw(setup(), body);
    expect(response.status).toBe(400);
    const { errors } = await response.json();
    expect(errors[0].message).toContain(says);
  });
});

describe("the twin OAuth servers: requests they can't use", () => {
  it.each([
    ["QuickBooks", "/connect/oauth2?client_id=a&response_type=code&scope=com.intuit.quickbooks.accounting&redirect_uri=/callback"],
    ["Jobber", "/api/oauth/authorize?client_id=a&response_type=code&redirect_uri=/callback"],
  ])("%s answers a redirect_uri that isn't an absolute URL with invalid_request", async (_vendor, url) => {
    const response = await setup().app.request(url);
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: "invalid_request" });
  });

  it("QuickBooks says to send the token request form-encoded when it gets JSON", async () => {
    const response = await setup().app.request("/oauth2/v1/tokens/bearer", {
      method: "POST",
      headers: { Authorization: `Basic ${btoa("a:b")}`, "Content-Type": "application/json" },
      body: JSON.stringify({ grant_type: "authorization_code", code: "x", redirect_uri: "http://localhost/cb" }),
    });
    expect(response.status).toBe(400);
    expect((await response.json()).error_description).toContain("application/x-www-form-urlencoded");
  });

  it("QuickBooks answers a revoke request with JSON it can't parse with invalid_request", async () => {
    const response = await setup().app.request("/v2/oauth2/tokens/revoke", {
      method: "POST",
      headers: { Authorization: `Basic ${btoa("a:b")}`, "Content-Type": "application/json" },
      body: "{not json",
    });
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: "invalid_request" });
  });

  it("Jobber answers a token request body it can't parse with invalid_request", async () => {
    const response = await setup().app.request("/api/oauth/token", {
      method: "POST",
      headers: { "Content-Type": "multipart/form-data; boundary=x" },
      body: "this is not multipart",
    });
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: "invalid_request" });
  });
});

describe("an error the twin didn't expect", () => {
  it("is answered as a 500 in the vendor's own error format, and logged with its stack", async () => {
    const { twin } = setup();
    const app = new Hono();
    app.get("/v3/company/1/boom", () => {
      throw new Error("a bug in the twin");
    });
    app.onError(answerUnexpectedErrors(twin));
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const response = await app.request("/v3/company/1/boom");
      expect(response.status).toBe(500);
      expect((await response.json()).Fault).toMatchObject({ type: "SystemFault", Error: [{ code: "10000" }] });
      expect(String(log.mock.calls[0]?.[0])).toContain("a bug in the twin");
    } finally {
      log.mockRestore();
    }
  });
});

describe("request bodies too big to be real", () => {
  const huge = JSON.stringify({ DisplayName: "x".repeat(11 * 1024 * 1024) }); // 11 MB: no real request is this big

  it("answer 413 in each vendor's own format, naming the limit, before the twin reads them", async () => {
    const harness = setup();
    const qbo = await qboRaw(harness, "/customer", huge);
    expect(qbo.status).toBe(413);
    expect((await qbo.json()).Fault.Error[0].Detail).toContain("10 MB");
    const jobber = await jobberRaw(harness, huge);
    expect(jobber.status).toBe(413);
    expect((await jobber.json()).errors[0].message).toContain("10 MB");
    const housecallpro = await harness.hcpPost("/customers", { first_name: "x".repeat(11 * 1024 * 1024) });
    expect(housecallpro.status).toBe(413);
    expect((await housecallpro.json()).error.message).toContain("10 MB");
  });

  it("answer 413 on the control plane too", async () => {
    const response = await setup().app.request("/_twin/scenario", { method: "POST", body: huge });
    expect(response.status).toBe(413);
    expect((await response.json()).error).toContain("10 MB");
  });
});

describe("values nested too deeply to write out", () => {
  // JSON.parse reads a list nested thousands deep, which JSON.stringify can't write back: 4,000 deep is about 8 KB.
  const deep = (depth = 4000) => `${"[".repeat(depth)}"x"${"]".repeat(depth)}`;

  it("answer QuickBooks' 2010 naming the field, not a 500", async () => {
    const response = await qboRaw(setup(), "/customer", `{"DisplayName": ${deep()}}`);
    expect(response.status).toBe(400);
    expect((await response.json()).Fault.Error[0]).toMatchObject({ code: "2010", element: "DisplayName" });
  });

  it("say that an object, too, was nested too deeply, rather than writing it out", async () => {
    const deepObject = `${'{"a":'.repeat(4000)}"x"${"}".repeat(4000)}`;
    const response = await qboRaw(setup(), "/customer", `{"DisplayName": ${deepObject}}`);
    expect(response.status).toBe(400);
    const [error] = (await response.json()).Fault.Error;
    expect(error).toMatchObject({ code: "2010", element: "DisplayName" });
    expect(error.Detail).toContain("an object nested too deeply");
  });

  it.each([
    ["/customers", (value: string) => `{"first_name": ${value}}`, "first_name"],
    ["/customers", (value: string) => `{"first_name": "Ada", "tags": ${value}}`, "tags"],
    ["/customers", (value: string) => `{"first_name": "Ada", "addresses": [{"street": ${value}}]}`, "addresses[0].street"],
    ["/jobs", (value: string) => `{"customer_id": "c", "address_id": "a", "invoice_number": ${value}}`, "invoice_number"],
  ])("answer Housecall Pro's 422 naming the field, not a 500, on POST %s", async (path, body, field) => {
    const harness = setup();
    const [customer] = (await (await harness.hcpGet("/customers?page_size=1")).json()).customers;
    const sent = body(deep()).replace('"c"', `"${customer.id}"`).replace('"a"', `"${customer.addresses[0].id}"`);
    const response = await harness.app.request(`/housecallpro${path}`, {
      method: "POST",
      headers: { Authorization: "Token test-key", "Content-Type": "application/json" },
      body: sent,
    });
    expect(response.status).toBe(422);
    expect((await response.json()).error.message).toContain(field);
  });
});
