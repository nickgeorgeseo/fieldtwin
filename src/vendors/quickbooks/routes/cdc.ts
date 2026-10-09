import type { Hono } from "hono";
import type { Twin } from "../../../core/twin.ts";
import { qboErrors } from "../errors.ts";
import type { QboEntityName, QboState } from "../types.ts";
import { asResponse, COMPANY, ENTITY_RECORDS, entityNamed } from "./entity.ts";

/**
 * Change data capture: GET /cdc?entities=Customer,Invoice&changedSince=<dateTime>
 * https://developer.intuit.com/app/developer/qbo/docs/api/accounting/all-entities/changedatacapture
 *
 * "Returns all objects specified by entityList that have changed since the specified date-time. Look-back time
 * can be up to 30 days." Objects are "grouped by type and then in order of last updated time within the group",
 * at most 1000 in all, each as its full payload.
 *
 * Changes are read from each record's MetaData.LastUpdatedTime, which apply() keeps in step with the event
 * log. (Reading the log's own timestamps instead would report seeded history as changed at reset time.)
 */
const LOOK_BACK_DAYS = 30;
const MAX_OBJECTS = 1000;

export function cdcRoutes(app: Hono, twin: Twin): void {
  const now = () => twin.clock.nowIso();

  app.get(`${COMPANY}/cdc`, (c) => {
    const entityList = c.req.query("entities");
    const changedSince = c.req.query("changedSince");
    if (!entityList) return c.json(qboErrors.missingField("entities", now()), 400);
    if (!changedSince) return c.json(qboErrors.missingField("changedSince", now()), 400);

    const sinceMs = parseChangedSince(changedSince);
    if (sinceMs === undefined) return c.json(qboErrors.invalidDate("changedSince", changedSince, now()), 400);
    if (twin.clock.nowMs() - sinceMs > LOOK_BACK_DAYS * 86_400_000) {
      return c.json(qboErrors.invalidDateRange("changedSince", `changedSince must be within the last ${LOOK_BACK_DAYS} days`, now()), 400);
    }

    const entities: QboEntityName[] = [];
    for (const name of entityList.split(",")) {
      const entity = entityNamed(name);
      if (!entity) {
        return c.json(
          qboErrors.unsupportedOperation(
            `The twin can't capture changes for ${name.trim()}. Supported: Customer, Item, Invoice, Payment`,
            now(),
          ),
          400,
        );
      }
      entities.push(entity);
    }

    let remaining = MAX_OBJECTS;
    const state = twin.state<QboState>("quickbooks");
    const groups = entities.map((entity) => {
      const changed = [...ENTITY_RECORDS[entity](state).values()]
        .filter((record) => Date.parse(record.MetaData.LastUpdatedTime) >= sinceMs)
        .sort((a, b) => Date.parse(a.MetaData.LastUpdatedTime) - Date.parse(b.MetaData.LastUpdatedTime))
        .slice(0, remaining);
      remaining -= changed.length;
      return changed.length ? { [entity]: changed.map(asResponse), startPosition: 1, maxResults: changed.length } : {};
    });

    return c.json({ CDCResponse: [{ QueryResponse: groups }], time: now() });
  });
}

/** Accepts the documented forms: "2015-11-28", "2011-08-10T10:20:30-0700", and full ISO 8601. */
function parseChangedSince(value: string): number | undefined {
  const normalized = value.replace(/([+-]\d{2})(\d{2})$/, "$1:$2");
  const ms = Date.parse(normalized);
  return Number.isNaN(ms) ? undefined : ms;
}
