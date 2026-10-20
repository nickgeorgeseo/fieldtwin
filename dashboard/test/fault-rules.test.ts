import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { FAULT_PRESETS, withRule } from "../lib/fault-rules.ts";

const slow = { name: "jobber-slow", vendor: "jobber", rate: 1, effect: { latencyMs: 800 } };
const throttled = { name: "qbo-throttled", vendor: "quickbooks", rate: 0.2, effect: { status: 429 } };

describe("writing fault rules from presets", () => {
  it("adds a preset to the rules being written", () => {
    assert.deepEqual(JSON.parse(withRule(JSON.stringify([slow]), throttled)), [slow, throttled]);
  });

  it("replaces a rule of the same name instead of adding it twice", () => {
    const faster = { ...slow, effect: { latencyMs: 100 } };
    assert.deepEqual(JSON.parse(withRule(JSON.stringify([slow, throttled]), faster)), [faster, throttled]);
  });

  it("starts a new list when what's written isn't one", () => {
    assert.deepEqual(JSON.parse(withRule("not json", slow)), [slow]);
    assert.deepEqual(JSON.parse(withRule('{"name": "x"}', slow)), [slow]);
  });

  it("offers presets for every vendor the twin serves", () => {
    assert.deepEqual([...new Set(FAULT_PRESETS.map((preset) => preset.rule.vendor))], ["quickbooks", "jobber", "housecallpro"]);
  });

  it("names every preset differently, so adding one never replaces another", () => {
    const names = FAULT_PRESETS.map((preset) => preset.rule.name);
    assert.equal(new Set(names).size, names.length);
  });
});
