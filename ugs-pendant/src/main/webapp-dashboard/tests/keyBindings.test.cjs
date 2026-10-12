const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const ts = require("typescript");
const vm = require("node:vm");

// Transpile a util and run it in a vm; `deps` resolves its relative requires.
const load = (name, deps = {}) => {
  const source = fs.readFileSync(path.join(__dirname, `../src/utils/${name}.ts`), "utf8");
  const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: "ES2020" } }).outputText;
  const sandbox = { exports: {}, require: (p) => deps[p], Number, Math, Set, Map, Object, Array, JSON, RegExp, String, Boolean };
  vm.runInNewContext(compiled, sandbox);
  return sandbox.exports;
};

const presets = load("jogPresets");
const actions = load("dashboardActions");
const kb = load("keyBindings", { "./dashboardActions": actions });
// vm objects have another realm's prototypes, so compare through JSON.
const json = (v) => JSON.stringify(v);
const ev = (code, mods = {}) => ({ code, ctrlKey: false, altKey: false, shiftKey: false, metaKey: false, ...mods });

test("stepPreset walks the ladder and stays at the ends", () => {
  const o = presets.STEP_SIZE_OPTIONS;
  assert.equal(presets.stepPreset(o, 1, 1), 10);
  assert.equal(presets.stepPreset(o, 1, -1), 0.1);
  assert.equal(presets.stepPreset(o, 1000, 1), 1000);
  assert.equal(presets.stepPreset(o, 0.01, -1), 0.01);
});

test("stepPreset moves a non-preset value to the nearest preset in that direction", () => {
  const o = presets.FEED_RATE_OPTIONS;
  assert.equal(presets.stepPreset(o, 750, 1), 1000);
  assert.equal(presets.stepPreset(o, 750, -1), 500);
  assert.equal(presets.stepPreset(o, 6000, -1), 5000);
});

test("comboFromEvent builds ordered combos and rejects unbindable keys", () => {
  assert.equal(kb.comboFromEvent(ev("ArrowLeft")), "ArrowLeft");
  assert.equal(kb.comboFromEvent(ev("Numpad4", { shiftKey: true, ctrlKey: true })), "Ctrl+Shift+Numpad4");
  assert.equal(kb.comboFromEvent(ev("ShiftLeft", { shiftKey: true })), null);
  assert.equal(kb.comboFromEvent(ev("Escape")), null);
  assert.equal(kb.comboFromEvent(ev("Tab")), null);
  assert.equal(kb.comboFromEvent(ev("Unidentified")), null);
  assert.equal(kb.comboFromEvent(ev("")), null);
});

test("formatCombo is readable", () => {
  assert.equal(kb.formatCombo("ArrowLeft"), "←");
  assert.equal(kb.formatCombo("Shift+KeyA"), "Shift+A");
  assert.equal(kb.formatCombo("Numpad4"), "Num 4");
  assert.equal(kb.formatCombo("NumpadAdd"), "Num +");
  assert.equal(kb.formatCombo("Digit7"), "7");
  assert.equal(kb.formatCombo("F5"), "F5");
});

test("defaults jog with arrows and the keypad, and bind nothing dangerous", () => {
  const d = kb.defaultKeyBindingSettings();
  assert.equal(d.enabled, false);
  assert.equal(json(d.bindings["jog.xMinus"]), json(["ArrowLeft", "Numpad4"]));
  for (const id of ["job.start", "job.pause", "job.stop", "machine.softReset", "machine.home", "machine.zeroAll"]) {
    assert.equal(d.bindings[id].length, 0, id);
  }
  // No combo is bound twice by default.
  const all = Object.values(d.bindings).flat();
  assert.equal(new Set(all).size, all.length);
});

test("assignCombo takes a combo from its previous owner", () => {
  const { bindings, displaced } = kb.assignCombo(kb.defaultBindings(), "job.stop", "ArrowLeft");
  assert.equal(displaced, "jog.xMinus");
  assert.equal(json(bindings["jog.xMinus"]), json(["Numpad4"]));
  assert.equal(json(bindings["job.stop"]), json(["ArrowLeft"]));
  assert.equal(kb.actionForCombo(bindings, "ArrowLeft"), "job.stop");
});

test("assignCombo to the action that already has it is not a displacement", () => {
  const { bindings, displaced } = kb.assignCombo(kb.defaultBindings(), "jog.xMinus", "ArrowLeft");
  assert.equal(displaced, null);
  assert.equal(json(bindings["jog.xMinus"]), json(["Numpad4", "ArrowLeft"]));
});

test("removeCombo", () => {
  const next = kb.removeCombo(kb.defaultBindings(), "jog.xMinus", "ArrowLeft");
  assert.equal(json(next["jog.xMinus"]), json(["Numpad4"]));
});

test("sanitize: bad input falls back to defaults, off", () => {
  for (const raw of [null, undefined, 5, "x", [], {}]) {
    const s = kb.sanitizeKeyBindingSettings(raw);
    assert.equal(s.enabled, false);
    assert.equal(json(s.bindings), json(kb.defaultBindings()));
  }
});

test("hold-to-jog is off by default and only an explicit true turns it on", () => {
  assert.equal(kb.defaultKeyBindingSettings().holdToJog, false);
  assert.equal(kb.sanitizeKeyBindingSettings({ holdToJog: true }).holdToJog, true);
  assert.equal(kb.sanitizeKeyBindingSettings({ holdToJog: "yes" }).holdToJog, false);
  assert.equal(kb.sanitizeKeyBindingSettings({ enabled: true, bindings: {} }).holdToJog, false);
});

test("sanitize: keeps valid entries, drops unknown actions, bad combos and duplicates", () => {
  const s = kb.sanitizeKeyBindingSettings({
    enabled: true,
    bindings: {
      "jog.xMinus": ["KeyA", "KeyA", "not a combo", 42, "Tab"],
      "job.stop": ["KeyA", "KeyS"],
      "bogus.action": ["KeyZ"],
      "macro:abc-123": ["Digit1"],
    },
  });
  assert.equal(s.enabled, true);
  assert.equal(json(s.bindings["jog.xMinus"]), json(["KeyA"]));
  assert.equal(json(s.bindings["job.stop"]), json(["KeyS"]));
  assert.equal(s.bindings["bogus.action"], undefined);
  assert.equal(json(s.bindings["macro:abc-123"]), json(["Digit1"]));
});

test("sanitize: an action the person emptied stays empty; one never stored gets its defaults", () => {
  const s = kb.sanitizeKeyBindingSettings({ enabled: false, bindings: { "jog.xMinus": [] } });
  assert.equal(s.bindings["jog.xMinus"].length, 0);
  assert.equal(json(s.bindings["jog.xPlus"]), json(["ArrowRight", "Numpad6"]));
});

test("sanitize: a default that a stored action already took is not given twice", () => {
  const s = kb.sanitizeKeyBindingSettings({ bindings: { "job.stop": ["ArrowRight"] } });
  assert.equal(json(s.bindings["job.stop"]), json(["ArrowRight"]));
  assert.equal(json(s.bindings["jog.xPlus"]), json(["Numpad6"]));
});

test("typing targets keep their keys; radios and buttons do not", () => {
  const t = (tagName, extra = {}) => ({ tagName, ...extra });
  assert.equal(kb.isTypingTarget(t("INPUT", { type: "text" })), true);
  assert.equal(kb.isTypingTarget(t("INPUT")), true);
  assert.equal(kb.isTypingTarget(t("INPUT", { type: "number" })), true);
  assert.equal(kb.isTypingTarget(t("INPUT", { type: "range" })), true);
  assert.equal(kb.isTypingTarget(t("INPUT", { type: "radio" })), false);
  assert.equal(kb.isTypingTarget(t("INPUT", { type: "checkbox" })), false);
  assert.equal(kb.isTypingTarget(t("TEXTAREA")), true);
  assert.equal(kb.isTypingTarget(t("SELECT")), true);
  assert.equal(kb.isTypingTarget(t("DIV", { isContentEditable: true })), true);
  assert.equal(kb.isTypingTarget(t("DIV", { closest: () => ({}) })), true);
  assert.equal(kb.isTypingTarget(t("DIV", { closest: () => null })), false);
  assert.equal(kb.isTypingTarget(t("BUTTON")), false);
  assert.equal(kb.isTypingTarget(null), false);
});

test("Enter and Space on a control belong to the control", () => {
  assert.equal(kb.isActivationOnControl("Space", { tagName: "BUTTON" }), true);
  assert.equal(kb.isActivationOnControl("Enter", { tagName: "A" }), true);
  assert.equal(kb.isActivationOnControl("Space", { tagName: "INPUT", type: "radio" }), true);
  assert.equal(kb.isActivationOnControl("Space", { tagName: "DIV", getAttribute: () => "button" }), true);
  assert.equal(kb.isActivationOnControl("Space", { tagName: "DIV", getAttribute: () => null }), false);
  assert.equal(kb.isActivationOnControl("ArrowLeft", { tagName: "BUTTON" }), false);
  assert.equal(kb.isActivationOnControl("Space", { tagName: "BODY" }), false);
});

test("commandFor resolves actions and macros", () => {
  assert.equal(json(actions.commandFor("jog.xPlusYMinus")), json({ kind: "jog", x: 1, y: -1, z: 0 }));
  assert.equal(json(actions.commandFor("macro:abc")), json({ kind: "macro", uuid: "abc" }));
  assert.equal(actions.commandFor("macro:"), null);
  assert.equal(actions.commandFor("nope"), null);
  assert.equal(new Set(actions.ACTIONS.map((a) => a.id)).size, actions.ACTIONS.length);
});

test("availability mirrors the on-screen controls", () => {
  const ok = (id, state, extra = {}) =>
    actions.isCommandAvailable(actions.commandFor(id), { connected: true, state, hasFile: true, ...extra });
  // Jog and macros: IDLE or JOG only.
  assert.equal(ok("jog.xPlus", "IDLE"), true);
  assert.equal(ok("jog.xPlus", "JOG"), true);
  assert.equal(ok("jog.xPlus", "RUN"), false);
  assert.equal(ok("jog.xPlus", "ALARM"), false);
  assert.equal(ok("macro:abc", "HOLD"), false);
  // Start needs a file and IDLE/HOLD; pause only while running; stop also covers a jog.
  assert.equal(ok("job.start", "IDLE"), true);
  assert.equal(ok("job.start", "IDLE", { hasFile: false }), false);
  assert.equal(ok("job.start", "HOLD"), true);
  assert.equal(ok("job.start", "RUN"), false);
  assert.equal(ok("job.pause", "RUN"), true);
  assert.equal(ok("job.pause", "IDLE"), false);
  assert.equal(ok("job.stop", "JOG"), true);
  assert.equal(ok("job.stop", "IDLE"), false);
  // Zero / home / return: IDLE only. Unlock any time. Overrides not in alarm.
  assert.equal(ok("machine.zeroX", "IDLE"), true);
  assert.equal(ok("machine.zeroX", "RUN"), false);
  assert.equal(ok("machine.home", "JOG"), false);
  assert.equal(ok("machine.unlock", "ALARM"), true);
  assert.equal(ok("override.feedPlus", "RUN"), true);
  assert.equal(ok("override.feedPlus", "HOLD"), true);
  assert.equal(ok("override.feedPlus", "ALARM"), false);
  // Settings-only actions work in any state, but nothing works without a connection.
  assert.equal(ok("step.xyUp", "RUN"), true);
  assert.equal(
    actions.isCommandAvailable(actions.commandFor("step.xyUp"), { connected: false, state: "IDLE", hasFile: true }),
    false
  );
});
