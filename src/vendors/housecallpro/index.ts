import type { VendorTwin } from "../../core/vendor-twin.ts";
import { hcpErrorForStatus } from "./errors.ts";
import { describeHcpEvent } from "./events.ts";
import { HCP } from "./routes/base.ts";
import { housecallproRoutes } from "./routes/index.ts";
import { seedHousecallPro } from "./seed.ts";
import { applyHcpEvent, createHcpState } from "./state.ts";
import type { HcpState } from "./types/index.ts";

export const housecallproTwin: VendorTwin<HcpState> = {
  name: "housecallpro",
  pathPrefix: HCP,
  createState: createHcpState,
  apply: applyHcpEvent,
  describeEvent: describeHcpEvent,
  seed: seedHousecallPro,
  routes: housecallproRoutes,
  errorBody: (status, message) => hcpErrorForStatus(status, message),
};
