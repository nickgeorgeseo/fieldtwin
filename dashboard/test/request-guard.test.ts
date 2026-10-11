import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { refusal } from "../lib/request-guard.ts";

function request(method: string, headers: Record<string, string>): Request {
  return new Request("http://localhost:4020/api/twin", { method, headers });
}

describe("which requests the dashboard forwards to the twin", () => {
  it("lets pages on this machine read", () => {
    assert.equal(refusal(request("GET", { host: "localhost:4020" })), null);
  });

  it("answers as 127.0.0.1 and [::1] too", () => {
    assert.equal(refusal(request("GET", { host: "127.0.0.1:4020" })), null);
    assert.equal(refusal(request("GET", { host: "[::1]:4020" })), null);
  });

  it("refuses a request addressed to any other host name, as a page that rebinds its DNS to 127.0.0.1 sends", () => {
    assert.match(refusal(request("GET", { host: "attacker.example:4020" })) ?? "", /only answers on this machine/);
  });

  it("accepts a change from the dashboard's own pages", () => {
    assert.equal(refusal(request("POST", { host: "localhost:4020", origin: "http://localhost:4020" })), null);
    assert.equal(refusal(request("PUT", { host: "[::1]:4020", origin: "http://[::1]:4020" })), null);
  });

  it("refuses a change sent from another site", () => {
    assert.match(refusal(request("POST", { host: "localhost:4020", origin: "https://attacker.example" })) ?? "", /own pages/);
  });

  it("refuses a change from another app on this machine", () => {
    assert.match(refusal(request("PUT", { host: "localhost:4020", origin: "http://localhost:3000" })) ?? "", /own pages/);
  });

  it("refuses a change that doesn't say where it came from", () => {
    assert.match(refusal(request("POST", { host: "localhost:4020" })) ?? "", /own pages/);
    assert.match(refusal(request("POST", { host: "localhost:4020", origin: "null" })) ?? "", /own pages/);
  });
});
