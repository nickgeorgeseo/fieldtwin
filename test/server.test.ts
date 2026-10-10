import { describe, expect, it } from "vitest";
import { listenOn } from "../src/server.ts";

/**
 * The twin accepts any bearer token by default and its control plane has no auth (it is a local test tool), so
 * it must not be reachable from the network unless someone asks for that.
 */
describe("the server", () => {
  it("listens on the loopback address only, at port 4010, by default", () => {
    expect(listenOn({})).toEqual({ hostname: "127.0.0.1", port: 4010 });
  });

  it("listens wherever FIELDTWIN_HOST and FIELDTWIN_PORT say, for running in a container", () => {
    expect(listenOn({ FIELDTWIN_HOST: "0.0.0.0", FIELDTWIN_PORT: "8080" })).toEqual({ hostname: "0.0.0.0", port: 8080 });
  });
});
