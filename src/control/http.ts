import { Hono } from "hono";
import type { Twin } from "../core/twin.ts";
import * as ops from "./operations.ts";

/**
 * The control plane: http://localhost:4010/_twin/...
 * Thin HTTP wrappers around operations.ts. Keep logic out of this file.
 */
export function controlRoutes(twin: Twin): Hono {
  const app = new Hono();

  app.get("/_twin", (c) => c.json(ops.describeTwin(twin)));
  app.post("/_twin/reset", (c) => c.json(ops.resetTwin(twin)));
  app.post("/_twin/clock/advance", async (c) => c.json(ops.advanceClock(twin, (await c.req.json()).minutes)));
  app.post("/_twin/checkpoints/:name", (c) => c.json(ops.createCheckpoint(twin, c.req.param("name"))));
  app.get("/_twin/checkpoints/:name/changes", (c) =>
    c.json(ops.listChanges(twin, c.req.param("name"), { onlyFromApi: c.req.query("source") === "api" })),
  );
  app.post("/_twin/checkpoints/:name/rewind", (c) => c.json(ops.rewindTo(twin, c.req.param("name"))));
  app.put("/_twin/faults", async (c) => c.json(ops.setFaults(twin, await c.req.json())));
  app.put("/_twin/auth", async (c) => c.json(ops.setAuthMode(twin, ((await c.req.json()) as { mode?: unknown }).mode)));
  app.post("/_twin/scenario", async (c) => c.json(ops.loadScenario(twin, await c.req.text())));
  app.get("/_twin/log.jsonl", (c) => c.text(ops.exportLog(twin)));

  // Control-plane mistakes (unknown checkpoint, bad scenario) come back as readable 400s.
  app.onError((error, c) => c.json({ error: error.message }, 400));
  return app;
}
