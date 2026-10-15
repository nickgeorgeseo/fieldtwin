import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { readAnswer, readLogAnswer } from "../lib/twin-api.ts";

describe("reading the twin's answers", () => {
  it("returns the JSON of a successful answer", async () => {
    assert.deepEqual(await readAnswer(Response.json({ authMode: "oauth" })), { authMode: "oauth" });
  });

  it("throws the twin's own words when it refuses", async () => {
    const refused = Response.json({ error: "minutes must be a number from 0 to 5,256,000 (ten years)" }, { status: 400 });
    await assert.rejects(readAnswer(refused), { message: "minutes must be a number from 0 to 5,256,000 (ten years)" });
  });

  it("names the status when an answer has no words of its own", async () => {
    await assert.rejects(readAnswer(new Response("<html>oops</html>", { status: 500 })), { message: "The twin answered HTTP 500." });
  });

  it("reads the event log, which is JSON Lines rather than JSON", async () => {
    assert.equal(
      await readAnswer(new Response('{"seq":1}\n{"seq":2}', { headers: { "content-type": "text/plain" } }), "text"),
      '{"seq":1}\n{"seq":2}',
    );
  });
});

describe("reading on in the event log", () => {
  it("reads the lines and where the log ends", async () => {
    const answer = new Response('{"seq":283}', {
      headers: { "content-type": "text/plain", "x-twin-log-position": "283-5f0c3a9e81d27b46" },
    });
    assert.deepEqual(await readLogAnswer(answer), { text: '{"seq":283}', position: "283-5f0c3a9e81d27b46" });
  });

  it("knows the twin's 409: the log has changed since the position asked after", async () => {
    const changed = Response.json({ error: "The log has changed since 283-5f0c3a9e81d27b46." }, { status: 409 });
    assert.equal(await readLogAnswer(changed), "changed");
  });

  it("has no position from a twin too old to say where its log ends, and throws the twin's words otherwise", async () => {
    assert.deepEqual(await readLogAnswer(new Response('{"seq":1}')), { text: '{"seq":1}', position: null });
    await assert.rejects(readLogAnswer(Response.json({ error: 'No checkpoint named "x"' }, { status: 400 })), {
      message: 'No checkpoint named "x"',
    });
  });
});
