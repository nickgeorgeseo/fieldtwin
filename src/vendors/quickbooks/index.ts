import type { VendorTwin } from "../../core/vendor-twin.ts";
import { qboFault } from "./errors.ts";
import { quickbooksRoutes } from "./routes.ts";
import { seedQuickBooks } from "./seed.ts";
import { applyQboEvent, createQboState } from "./state.ts";
import type { QboState } from "./types.ts";

export const quickbooksTwin: VendorTwin<QboState> = {
  name: "quickbooks",
  pathPrefix: "/v3",
  createState: createQboState,
  apply: applyQboEvent,
  seed: seedQuickBooks,
  routes: quickbooksRoutes,
  errorBody: (status, message, twin) =>
    status === 429
      ? qboFault("003001", "ThrottleExceeded", message, twin.clock.nowIso(), "SERVICE")
      : qboFault(String(status), "Injected fault", message, twin.clock.nowIso(), "SystemFault"),
};
