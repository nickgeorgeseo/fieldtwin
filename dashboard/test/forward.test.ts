import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { forwardToTwin } from "../lib/forward.ts";

const TWIN = "http://localhost:4010";
const SAME_ORIGIN = { host: "localhost:4020", origin: "http://localhost:4020" };

/** A twin that answers every request with `answer`, and remembers what it was asked. */
function fakeTwin(answer = () => Response.json({ ok: true })) {
  const asked: { url: string; method: string; body: string | undefined; contentType: string | null }[] = [];
  const fetch = async (url: string | URL | Request, init?: RequestInit) => {
    const headers = new Headers(init?.headers);
    asked.push({
      url: String(url),
      method: init?.method ?? "GET",
      body: init?.body as string | undefined,
      contentType: headers.get("content-type"),
    });
    return answer();
  };
  return { asked, fetch };
}

describe("forwarding the dashboard's requests to the twin's control plane", () => {
  it("forwards a read to the same path under /_twin, with its query", async () => {
    const twin = fakeTwin();
    const request = new Request("http://localhost:4020/api/twin/checkpoints/before/changes?source=api", {
      headers: { host: "localhost:4020" },
    });
    await forwardToTwin(request, ["checkpoints", "before", "changes"], { twinUrl: TWIN, fetch: twin.fetch });
    assert.deepEqual(twin.asked, [
      { url: `${TWIN}/_twin/checkpoints/before/changes?source=api`, method: "GET", body: undefined, contentType: null },
    ]);
  });

  it("forwards /api/twin itself to /_twin, the twin's status", async () => {
    const twin = fakeTwin();
    await forwardToTwin(new Request("http://localhost:4020/api/twin", { headers: { host: "localhost:4020" } }), [], {
      twinUrl: TWIN,
      fetch: twin.fetch,
    });
    assert.equal(twin.asked[0]?.url, `${TWIN}/_twin`);
  });

  it("forwards a change with its body and content type", async () => {
    const twin = fakeTwin();
    const request = new Request("http://localhost:4020/api/twin/clock/advance", {
      method: "POST",
      headers: { ...SAME_ORIGIN, "content-type": "application/json" },
      body: '{"minutes":60}',
    });
    await forwardToTwin(request, ["clock", "advance"], { twinUrl: TWIN, fetch: twin.fetch });
    assert.deepEqual(twin.asked, [
      { url: `${TWIN}/_twin/clock/advance`, method: "POST", body: '{"minutes":60}', contentType: "application/json" },
    ]);
  });

  it("encodes each path segment, so a checkpoint's name stays one segment", async () => {
    const twin = fakeTwin();
    const request = new Request("http://localhost:4020/api/twin/checkpoints/x", { method: "POST", headers: SAME_ORIGIN });
    await forwardToTwin(request, ["checkpoints", "before agent/1"], { twinUrl: TWIN, fetch: twin.fetch });
    assert.equal(twin.asked[0]?.url, `${TWIN}/_twin/checkpoints/before%20agent%2F1`);
  });

  it("passes on the twin's answer and status, so its errors read the same", async () => {
    const twin = fakeTwin(() => Response.json({ error: 'No checkpoint named "nope"' }, { status: 400 }));
    const request = new Request("http://localhost:4020/api/twin/checkpoints/nope/rewind", { method: "POST", headers: SAME_ORIGIN });
    const answer = await forwardToTwin(request, ["checkpoints", "nope", "rewind"], { twinUrl: TWIN, fetch: twin.fetch });
    assert.equal(answer.status, 400);
    assert.deepEqual(await answer.json(), { error: 'No checkpoint named "nope"' });
    assert.equal(answer.headers.get("cache-control"), "no-store");
  });

  it("says how to start the twin when it can't be reached", async () => {
    const fetch = async () => {
      throw new TypeError("fetch failed");
    };
    const answer = await forwardToTwin(new Request("http://localhost:4020/api/twin", { headers: { host: "localhost:4020" } }), [], {
      twinUrl: TWIN,
      fetch,
    });
    assert.equal(answer.status, 502);
    assert.match((await answer.json()).error, /Can't reach the twin at http:\/\/localhost:4010.*npm start/);
  });

  it("refuses what the guard refuses, without asking the twin", async () => {
    const twin = fakeTwin();
    const request = new Request("http://localhost:4020/api/twin/reset", {
      method: "POST",
      headers: { host: "localhost:4020", origin: "https://attacker.example" },
    });
    const answer = await forwardToTwin(request, ["reset"], { twinUrl: TWIN, fetch: twin.fetch });
    assert.equal(answer.status, 403);
    assert.equal(twin.asked.length, 0);
  });

  it("refuses paths that try to climb out of the control plane", async () => {
    const twin = fakeTwin();
    for (const path of [[".."], ["checkpoints", ".", "x"], ["", "v3"]]) {
      const answer = await forwardToTwin(new Request("http://localhost:4020/api/twin", { headers: { host: "localhost:4020" } }), path, {
        twinUrl: TWIN,
        fetch: twin.fetch,
      });
      assert.equal(answer.status, 404, path.join("/"));
    }
    assert.equal(twin.asked.length, 0);
  });

  it("refuses methods the control plane doesn't use", async () => {
    const twin = fakeTwin();
    const request = new Request("http://localhost:4020/api/twin/faults", { method: "DELETE", headers: SAME_ORIGIN });
    const answer = await forwardToTwin(request, ["faults"], { twinUrl: TWIN, fetch: twin.fetch });
    assert.equal(answer.status, 405);
    assert.equal(twin.asked.length, 0);
  });
});
