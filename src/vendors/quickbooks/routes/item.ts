import type { Hono } from "hono";
import type { Twin } from "../../../core/twin.ts";
import { qboErrors } from "../errors.ts";
import type { QboState } from "../types.ts";
import { asResponse, COMPANY } from "./entity.ts";

/**
 * Item: https://developer.intuit.com/app/developer/qbo/docs/api/accounting/all-entities/item
 * The twin's Items are the world's price list, read only for now.
 */
export function itemRoutes(app: Hono, twin: Twin): void {
  const state = () => twin.state<QboState>("quickbooks");
  const now = () => twin.clock.nowIso();

  app.get(`${COMPANY}/item/:id`, (c) => {
    const item = state().items.get(c.req.param("id"));
    if (!item) return c.json(qboErrors.notFound(now()), 400);
    return c.json({ Item: asResponse(item), time: now() });
  });

  app.post(`${COMPANY}/item`, (c) =>
    c.json(
      qboErrors.unsupportedOperation(
        "Operation Create/Update is not supported for Item by the twin yet. Items come from the world's price list.",
        now(),
      ),
      400,
    ),
  );
}
