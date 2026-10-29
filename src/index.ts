/**
 * What `import { startTwin } from "fieldtwin"` gets: a twin started from code, on its own port. createApp builds one
 * with no network at all, for frameworks that call a fetch handler directly (Hono's app.request, for one).
 */
export { type AppOptions, createApp } from "./app.ts";
export type { Twin } from "./core/twin.ts";
export type { AuthMode } from "./core/types.ts";
export { type RunningTwin, type StartOptions, startTwin } from "./start.ts";
