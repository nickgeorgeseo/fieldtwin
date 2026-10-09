import type { VendorTwin } from "../../core/vendor-twin.ts";
import { qboErrorForStatus } from "./errors.ts";
import { describeQboEvent } from "./events.ts";
import { quickbooksRoutes } from "./routes/index.ts";
import { seedQuickBooks } from "./seed.ts";
import { applyQboEvent, createQboState } from "./state.ts";
import type { QboState } from "./types.ts";

export const quickbooksTwin: VendorTwin<QboState> = {
  name: "quickbooks",
  pathPrefix: "/v3",
  createState: createQboState,
  apply: applyQboEvent,
  describeEvent: describeQboEvent,
  seed: seedQuickBooks,
  routes: quickbooksRoutes,
  errorBody: (status, message, twin) => qboErrorForStatus(status, message, twin.clock.nowIso()),
};
