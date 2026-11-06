import { describe, expect, it } from "vitest";
import { ACTIONS, actionKey } from "../dashboard/lib/actions.ts";
import { createApp } from "../src/app.ts";
import { describeVendors } from "../src/control/operations.ts";

/**
 * The dashboard names each action with a label and help of its own, so it lists them itself (dashboard/lib/actions.ts).
 * Its own tests can't build a twin, so this one checks the list against what the vendors really offer.
 */
describe("the dashboard's control room", () => {
  it("offers every action the twin's vendors have, and no other, so a new action can't be left off it", () => {
    const offered = describeVendors(createApp().twin).flatMap(({ name, actions }) => actions.map((action) => `${name}/${action}`));
    expect(ACTIONS.map(actionKey).sort()).toEqual(offered.sort());
  });
});
