import { type Context, Hono } from "hono";
import { LogChangedError } from "../core/event-log.ts";
import { isObject } from "../core/request-body.ts";
import { ScenarioEntryError } from "../core/timeline.ts";
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
  app.post("/_twin/clock/advance", async (c) =>
    c.json(await ops.advanceClock(twin, (await objectBody(c, '{"minutes": 60}')).minutes as number)),
  );
  app.post("/_twin/actions/:vendor/:action", async (c) =>
    c.json(
      await ops.runAction(twin, c.req.param("vendor"), c.req.param("action"), await body(c, "the action's parameters, like 2 (how many)")),
    ),
  );
  app.get("/_twin/webhooks", (c) => c.json(ops.describeWebhooks(twin)));
  app.put("/_twin/webhooks", async (c) => c.json(ops.setWebhooks(twin, await body(c, SUBSCRIPTIONS_EXAMPLE))));
  app.post("/_twin/checkpoints/:name", (c) => c.json(ops.createCheckpoint(twin, c.req.param("name"))));
  app.get("/_twin/checkpoints/:name/changes", (c) => {
    const changes = ops.listChanges(twin, c.req.param("name"), { source: c.req.query("source"), after: c.req.query("after") });
    return c.json(changes, 200, { "X-Twin-Log-Position": twin.log.position() });
  });
  app.post("/_twin/checkpoints/:name/rewind", (c) => c.json(ops.rewindTo(twin, c.req.param("name"))));
  app.put("/_twin/faults", async (c) => c.json(ops.setFaults(twin, await body(c, FAULTS_EXAMPLE))));
  app.put("/_twin/auth", async (c) => c.json(ops.setAuthMode(twin, (await objectBody(c, '{"mode": "oauth"}')).mode)));
  app.post("/_twin/scenario", async (c) => c.json(ops.loadScenario(twin, await c.req.text())));
  app.get("/_twin/scenarios", (c) => c.json(ops.listScenarios()));
  app.post("/_twin/scenarios/:name", (c) => c.json(ops.loadScenarioByName(twin, c.req.param("name"))));
  app.get("/_twin/log.jsonl", (c) => {
    const read = ops.exportLog(twin, { sinceCheckpoint: c.req.query("since"), after: c.req.query("after") });
    return c.text(read.jsonl, 200, { "X-Twin-Log-Position": read.position });
  });

  // Control-plane mistakes (unknown checkpoint, bad scenario) come back as readable 400s. A TypeError and its kin, or
  // a scheduled action that throws though its check passed, mean a bug in the twin, not the request: a 500, logged
  // with its stack and its cause's. A log read after a position from another history is neither: a 409, so the reader
  // knows to read the log again from the start.
  app.onError((error, c) => {
    const bug = [TypeError, RangeError, ReferenceError, ScenarioEntryError].some((kind) => error instanceof kind);
    if (bug) {
      console.error(`fieldtwin: unexpected error answering ${c.req.method} ${c.req.path}: ${stackOf(error)}`);
      return c.json(
        { error: `The twin hit an unexpected error (${error.message}). This is a bug in fieldtwin: its log has the details.` },
        500,
      );
    }
    return c.json({ error: error.message }, error instanceof LogChangedError ? 409 : 400);
  });
  return app;
}

const SUBSCRIPTIONS_EXAMPLE =
  'a list of subscriptions, like [{"vendor": "jobber", "url": "http://localhost:3000/hooks", "topics": ["INVOICE_UPDATE"], "clientId": "my-app", "clientSecret": "dev"}]';
const FAULTS_EXAMPLE = 'a list of fault rules, like [{"name": "slow", "vendor": "jobber", "rate": 0.5, "effect": {"latencyMs": 800}}]';

/** The JSON a request sent, or an error saying what to send instead. */
async function body(c: Context, example: string): Promise<unknown> {
  const text = await c.req.text();
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`${text.trim() ? "The request body isn't valid JSON" : "This needs a JSON request body"}. Send ${example}.`);
  }
}

async function objectBody(c: Context, example: string): Promise<Record<string, unknown>> {
  const value = await body(c, example);
  if (!isObject(value)) throw new Error(`Send a JSON object, like ${example}.`);
  return value;
}

/** An error's stack, then its cause's: for a scheduled action that threw, where in the action it threw. */
function stackOf(error: Error): string {
  const own = error.stack ?? error.message;
  return error.cause instanceof Error ? `${own}\nCaused by: ${stackOf(error.cause)}` : own;
}
