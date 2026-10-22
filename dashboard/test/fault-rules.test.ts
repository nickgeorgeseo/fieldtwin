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

describe("the ready-made Housecall Pro fault rules", () => {
  const preset = (name: string) => FAULT_PRESETS.find(({ rule }) => rule.name === name)?.rule;

  it("throttles Housecall Pro's API but not its OAuth endpoints, which share its prefix in the twin", () => {
    assert.deepEqual(preset("hcp-throttled"), {
      name: "hcp-throttled",
      vendor: "housecallpro",
      pathExcludes: "/oauth/",
      rate: 0.2,
      effect: { status: 429 },
    });
  });

  it("loses answers only to creating a customer, since one lost from the token endpoint would cost a refresh token for good", () => {
    const rule = preset("hcp-lost-customers");
    assert.equal(rule?.method, "POST");
    assert.equal(rule?.pathIncludes, "/customers");
    assert.deepEqual(rule?.effect, { status: 504, lostResponse: true });
  });

  it("gives every lost answer a status for the twin to answer with", () => {
    for (const { rule } of FAULT_PRESETS) {
      if (rule.effect.lostResponse) assert.equal(typeof rule.effect.status, "number", rule.name);
    }
  });

  it("picks webhook deliveries by topic alone, never by method or path", () => {
    const webhookRules = FAULT_PRESETS.map(({ rule }) => rule).filter((rule) => rule.webhook);
    assert.ok(webhookRules.length > 0);
    for (const rule of webhookRules) {
      assert.deepEqual([rule.method, rule.pathIncludes, rule.pathExcludes], [undefined, undefined, undefined], rule.name);
    }
  });
});
