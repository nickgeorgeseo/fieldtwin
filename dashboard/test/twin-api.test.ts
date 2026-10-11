import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { readAnswer } from "../lib/twin-api.ts";

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
