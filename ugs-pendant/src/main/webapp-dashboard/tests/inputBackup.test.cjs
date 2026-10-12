const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const ts = require("typescript");
const vm = require("node:vm");

const load = (name, deps = {}) => {
  const source = fs.readFileSync(path.join(__dirname, `../src/utils/${name}.ts`), "utf8");
  const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: "ES2020" } }).outputText;
  const sandbox = { exports: {}, require: (p) => deps[p], Number, Math, Set, Map, Object, Array, JSON, RegExp, String, Boolean, Date };
  vm.runInNewContext(compiled, sandbox);
  return sandbox.exports;
};

const pad = load("gamepadInput");
const actions = load("dashboardActions");
const kb = load("keyBindings", { "./dashboardActions": actions, "./gamepadInput": pad });
const backup = load("inputBackup", { "./gamepadInput": pad, "./dashboardActions": actions, "./keyBindings": kb });
const json = (v) => JSON.stringify(v);

const settingsWith = (bindings, extra = {}) => ({ ...kb.defaultKeyBindingSettings(), bindings, ...extra });

test("a backup carries bindings and stick tuning but never the on/off switches", () => {
  const s = settingsWith(kb.defaultBindings(), { enabled: true, gamepadEnabled: true, holdToJog: true, gamepadWhenUnfocused: true });
  const b = backup.buildInputBackup(s, new Date("2026-10-12T10:00:00Z"));
  assert.equal(b.app, "ugs-dashboard-input-bindings");
  assert.equal(b.exportedAt, "2026-10-12T10:00:00.000Z");
  assert.deepEqual(Object.keys(b).sort(), ["app", "bindings", "exportedAt", "padTuning", "version"]);
  assert.equal(backup.inputBackupFilename(new Date("2026-10-12T10:00:00Z")), "ugs-dashboard-input-bindings-2026-10-12.json");
});

test("a backup survives a round trip", () => {
  let b = kb.defaultBindings();
  b = kb.assignCombo(b, "job.stop", "Pad.B7").bindings;
  b = kb.assignCombo(b, "macro:abc-1", "Digit1").bindings;
  const s = settingsWith(b, { padTuning: { activation: 0.7, deadband: 0.2 } });
  const text = JSON.stringify(backup.buildInputBackup(s));
  const parsed = backup.parseInputBackup(text);
  assert.equal(parsed.ok, true);
  assert.equal(json(parsed.value.backup.bindings["job.stop"]), json(["Pad.B7"]));
  assert.equal(json(parsed.value.backup.bindings["macro:abc-1"]), json(["Digit1"]));
  assert.equal(json(parsed.value.backup.padTuning), json({ activation: 0.7, deadband: 0.2 }));
  assert.equal(parsed.value.counts.pad, 1);
  assert.equal(parsed.value.counts.macros, 1);
  assert.ok(parsed.value.counts.keyboard > 10);
  assert.equal(parsed.value.skipped, 0);
});

test("files that are not a bindings backup are refused with a reason", () => {
  const err = (text) => { const r = backup.parseInputBackup(text); assert.equal(r.ok, false); return r.error; };
  assert.match(err("not json"), /not valid JSON/);
  assert.match(err("[]"), /not a UGS Dashboard/);
  assert.match(err(JSON.stringify({ app: "ugs-dashboard-layouts", version: 1 })), /not a UGS Dashboard/);
  assert.match(err(JSON.stringify({ app: "ugs-dashboard-input-bindings", version: 99, bindings: {} })), /newer version/);
  assert.match(err(JSON.stringify({ app: "ugs-dashboard-input-bindings", version: 1 })), /no bindings/);
  assert.match(err("x".repeat(300 * 1024)), /too large/);
});

test("unusable entries are dropped and counted, not fatal", () => {
  const text = JSON.stringify({
    app: "ugs-dashboard-input-bindings", version: 1,
    bindings: { "jog.xPlus": ["ArrowRight", "bad combo!", "Pad.Nope"], "no.such.action": ["KeyZ"], "job.stop": ["Pad.B1", "Pad.B1"] },
    padTuning: { activation: 5, deadband: "x" },
  });
  const r = backup.parseInputBackup(text);
  assert.equal(r.ok, true);
  assert.equal(json(r.value.backup.bindings["jog.xPlus"]), json(["ArrowRight"]));
  assert.equal(json(r.value.backup.bindings["job.stop"]), json(["Pad.B1"]));
  assert.equal(r.value.backup.bindings["no.such.action"], undefined);
  assert.equal(r.value.skipped, 4);
  // tuning is clamped into range
  assert.equal(r.value.backup.padTuning.activation, 0.9);
  assert.equal(r.value.backup.padTuning.deadband, 0.3);
});

test("a file that leaves actions out does not import defaults for them", () => {
  const text = JSON.stringify({ app: "ugs-dashboard-input-bindings", version: 1, bindings: { "job.stop": ["Pad.B2"] } });
  const r = backup.parseInputBackup(text);
  assert.equal(r.ok, true);
  assert.equal(json(Object.keys(r.value.backup.bindings)), json(["job.stop"]));
  assert.equal(r.value.backup.padTuning, null);
});

test("importing replaces the chosen kind and leaves the other alone", () => {
  let current = kb.defaultBindings();
  current = kb.assignCombo(current, "job.stop", "Pad.B1").bindings;
  const incoming = { "jog.xPlus": ["KeyD", "Pad.HatE"], "job.stop": ["Pad.B9"] };

  const padOnly = kb.mergeImportedBindings(current, incoming, { keyboard: false, pad: true });
  assert.equal(json(padOnly["job.stop"]), json(["Pad.B9"]));
  assert.ok(padOnly["jog.xPlus"].includes("Pad.HatE"));
  assert.ok(padOnly["jog.xPlus"].includes("ArrowRight"), "keyboard keys kept");
  assert.ok(!padOnly["jog.xPlus"].includes("KeyD"), "file's keyboard key not imported");

  const keysOnly = kb.mergeImportedBindings(current, incoming, { keyboard: true, pad: false });
  assert.equal(json(keysOnly["jog.xPlus"]), json(["KeyD"]));
  assert.equal(json(keysOnly["job.stop"]), json(["Pad.B1"]), "current controller binding kept");
  // an action the file doesn't mention loses that kind of binding when its kind is imported
  assert.equal(keysOnly["jog.xMinus"].length, 0);
});

test("stick tuning is clamped and the release point stays inside the activation point", () => {
  assert.equal(json(pad.sanitizePadTuning(null)), json({ activation: 0.5, deadband: 0.3 }));
  assert.equal(json(pad.sanitizePadTuning({ activation: 0.01, deadband: 9 })), json({ activation: 0.2, deadband: 0.6 }));
  assert.equal(json(pad.axisThresholds({ activation: 0.5, deadband: 0.3 })), json({ press: 0.5, release: 0.3 }));
  // a dead band as wide as the activation point still leaves a gap
  const t = pad.axisThresholds({ activation: 0.3, deadband: 0.6 });
  assert.equal(t.press, 0.3);
  assert.ok(Math.abs(t.release - 0.25) < 1e-9);
});
