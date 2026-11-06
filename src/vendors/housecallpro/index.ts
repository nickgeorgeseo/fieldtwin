import type { VendorTwin } from "../../core/vendor-twin.ts";
import { hcpErrorForStatus, hcpErrorHeaders } from "./errors.ts";
import { describeHcpEvent } from "./events.ts";
import { HCP } from "./routes/base.ts";
import { housecallproRoutes } from "./routes/index.ts";
import { housecallproScenarioActions } from "./scenario-actions.ts";
import { seedHousecallPro } from "./seed.ts";
import { applyHcpEvent, createHcpState } from "./state.ts";
import type { HcpState } from "./types/index.ts";
import { housecallproWebhooks } from "./webhooks.ts";

export const housecallproTwin: VendorTwin<HcpState> = {
  name: "housecallpro",
  pathPrefix: HCP,
  createState: createHcpState,
  apply: applyHcpEvent,
  describeEvent: describeHcpEvent,
  seed: seedHousecallPro,
  routes: housecallproRoutes,
  scenarioActions: housecallproScenarioActions,
  webhooks: housecallproWebhooks,
  startHere: (origin) => ({ baseUrl: `${origin}${HCP}`, try: `GET ${origin}${HCP}/company`, headers: { Authorization: "Token dev" } }),
  errorBody: hcpErrorForStatus,
  errorHeaders: (status, twin) => hcpErrorHeaders(status, twin.clock.nowMs()),
};
