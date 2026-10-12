const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const ts = require("typescript");
const vm = require("node:vm");

const load = (name, deps = {}) => {
  const source = fs.readFileSync(path.join(__dirname, `../src/utils/${name}.ts`), "utf8");
  const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: "ES2020" } }).outputText;
  const sandbox = { exports: {}, require: (p) => deps[p], Number, Math, Set, Map, Object, Array, JSON, RegExp, String, Boolean };
  vm.runInNewContext(compiled, sandbox);
  return sandbox.exports;
};

const pad = load("gamepadInput");
const actions = load("dashboardActions");
const kb = load("keyBindings", { "./dashboardActions": actions, "./gamepadInput": pad });
const json = (v) => JSON.stringify(v);
const sorted = (set) => [...set].sort();

// What Chrome reported for a Bluetooth Xbox controller (045e:0b13): no standard
// mapping, 15 buttons, 10 axes, triggers resting at -1, D-pad hat on axis 9 whose
// neutral reading is a huge number.
const HAT_NEUTRAL = 1227133568;
const xbox = (overrides = {}) => ({
  index: 0,
  id: "Unknown Gamepad (Vendor: 045e Product: 0b13)",
  mapping: "",
  buttons: Array.from({ length: 15 }, () => ({ pressed: false, value: 0 })),
  axes: [-0.0, -0.0, 0.01, -1, -1, 0.02, 0, 0, 0, HAT_NEUTRAL],
  ...overrides,
});
const withAxis = (index, value, base = xbox()) => {
  const axes = [...base.axes];
  axes[index] = value;
  return { ...base, axes };
};
const withButton = (index, base = xbox()) => {
  const buttons = base.buttons.map((b) => ({ ...b }));
  buttons[index] = { pressed: true, value: 1 };
  return { ...base, buttons };
};

test("decodeHat: eight positions clockwise from up, neutral and sentinels are null", () => {
  const values = [-1, -0.714, -0.429, -0.143, 0.143, 0.429, 0.714, 1];
  assert.equal(json(values.map(pad.decodeHat)), json([0, 1, 2, 3, 4, 5, 6, 7]));
  assert.equal(pad.decodeHat(HAT_NEUTRAL), null);
  assert.equal(pad.decodeHat(1.2857), null);
  assert.equal(pad.decodeHat(0), null);
  assert.equal(pad.decodeHat(NaN), null);
});

test("a resting controller holds nothing: huge hat sentinel and -1 triggers are not inputs", () => {
  const state = new pad.GamepadInputState();
  assert.equal(json(sorted(state.update([xbox()]))), json([]));
  // and it stays quiet on later frames
  assert.equal(state.update([xbox()]).size, 0);
});

test("buttons report as Pad.B<n>", () => {
  const state = new pad.GamepadInputState();
  state.update([xbox()]);
  assert.equal(json(sorted(state.update([withButton(3)]))), json(["Pad.B3"]));
});

test("the D-pad hat reports cardinal directions, a diagonal holds two", () => {
  const state = new pad.GamepadInputState();
  state.update([xbox()]);
  assert.equal(json(sorted(state.update([withAxis(9, -1)]))), json(["Pad.HatN"]));
  assert.equal(json(sorted(state.update([withAxis(9, 0.143)]))), json(["Pad.HatS"]));
  assert.equal(json(sorted(state.update([withAxis(9, 0.429)]))), json(["Pad.HatS", "Pad.HatW"]));
  assert.equal(json(sorted(state.update([withAxis(9, 0.714)]))), json(["Pad.HatW"]));
  assert.equal(state.update([withAxis(9, HAT_NEUTRAL)]).size, 0);
});

test("a stick is pressed past half way from where it rested, with hysteresis", () => {
  const state = new pad.GamepadInputState();
  state.update([xbox()]);
  assert.equal(state.update([withAxis(0, -0.4)]).size, 0);
  assert.equal(json(sorted(state.update([withAxis(0, -0.6)]))), json(["Pad.A0-"]));
  // between the release and press thresholds it stays pressed...
  assert.equal(json(sorted(state.update([withAxis(0, -0.4)]))), json(["Pad.A0-"]));
  // ...and lets go below the release threshold
  assert.equal(state.update([withAxis(0, -0.2)]).size, 0);
  assert.equal(json(sorted(state.update([withAxis(1, 0.9)]))), json(["Pad.A1+"]));
});

test("a trigger resting at -1 is pressed by moving up, not by existing", () => {
  const state = new pad.GamepadInputState();
  state.update([xbox()]);
  assert.equal(state.update([withAxis(3, -1)]).size, 0);
  assert.equal(json(sorted(state.update([withAxis(3, 0.2)]))), json(["Pad.A3+"]));
});

test("rest positions come from the first reading and can be recalibrated", () => {
  const state = new pad.GamepadInputState();
  // connected with the stick already pushed: that is its rest until recalibrated
  assert.equal(state.update([withAxis(0, 0.9)]).size, 0);
  assert.equal(state.update([withAxis(0, 0.9)]).size, 0);
  assert.equal(json(sorted(state.update([withAxis(0, -0.1)]))), json(["Pad.A0-"]));
  state.recalibrate();
  assert.equal(state.update([withAxis(0, -0.1)]).size, 0);
});

test("a standard-mapped pad has no hat axis: its D-pad is buttons", () => {
  const standard = {
    index: 0, id: "Xbox 360 Controller (XInput STANDARD GAMEPAD)", mapping: "standard",
    buttons: Array.from({ length: 17 }, () => ({ pressed: false, value: 0 })),
    axes: [0, 0, 0, 0],
  };
  assert.equal(pad.hatAxisIndex(standard), -1);
  const state = new pad.GamepadInputState();
  state.update([standard]);
  const dpadUp = { ...standard, buttons: standard.buttons.map((b, i) => (i === 12 ? { pressed: true, value: 1 } : b)) };
  assert.equal(json(sorted(state.update([dpadUp]))), json(["Pad.B12"]));
});

test("non-finite and out-of-range axis values are never inputs", () => {
  const state = new pad.GamepadInputState();
  state.update([xbox()]);
  assert.equal(state.update([withAxis(0, NaN)]).size, 0);
  assert.equal(state.update([withAxis(1, 5000000)]).size, 0);
});

test("labels", () => {
  assert.equal(pad.describeInput("Pad.B3"), "Button 3");
  assert.equal(pad.describeInput("Pad.A1-"), "Axis 1 −");
  assert.equal(pad.describeInput("Pad.A4+"), "Axis 4 +");
  assert.equal(pad.describeInput("Pad.HatN"), "D-pad ↑");
  assert.equal(pad.describeInput("Pad.HatW"), "D-pad ←");
  assert.equal(kb.formatCombo("Pad.HatE"), "D-pad →");
  assert.equal(kb.formatCombo("Shift+KeyA"), "Shift+A");
});

test("controller inputs survive settings sanitising and obey the one-owner rule", () => {
  const s = kb.sanitizeKeyBindingSettings({
    gamepadEnabled: true,
    bindings: { "job.stop": ["Pad.B1", "Pad.Nope", "Pad.B1"], "jog.xPlus": ["Pad.HatE", "ArrowRight"] },
  });
  assert.equal(s.gamepadEnabled, true);
  assert.equal(s.gamepadWhenUnfocused, false);
  assert.equal(json(s.bindings["job.stop"]), json(["Pad.B1"]));
  assert.equal(json(s.bindings["jog.xPlus"]), json(["Pad.HatE", "ArrowRight"]));
  assert.equal(kb.actionForCombo(s.bindings, "Pad.HatE"), "jog.xPlus");
});

test("controller input is off by default and only when unfocused if asked", () => {
  const d = kb.defaultKeyBindingSettings();
  assert.equal(d.gamepadEnabled, false);
  assert.equal(d.gamepadWhenUnfocused, false);
  assert.equal(kb.sanitizeKeyBindingSettings({ gamepadWhenUnfocused: true }).gamepadWhenUnfocused, true);
  assert.equal(kb.sanitizeKeyBindingSettings({ gamepadWhenUnfocused: "yes" }).gamepadWhenUnfocused, false);
});

test("resetting one kind leaves the other alone", () => {
  let b = kb.defaultBindings();
  b = kb.assignCombo(b, "job.stop", "Pad.B1").bindings;
  b = kb.assignCombo(b, "jog.xPlus", "Pad.HatE").bindings;
  b = kb.removeCombo(b, "jog.xMinus", "ArrowLeft");

  const keysReset = kb.resetBindingsForKind(b, "keyboard");
  assert.ok(keysReset["jog.xMinus"].includes("ArrowLeft"));
  assert.ok(keysReset["jog.xMinus"].includes("Numpad4"));
  assert.ok(keysReset["job.stop"].includes("Pad.B1"));
  assert.ok(keysReset["jog.xPlus"].includes("Pad.HatE"));

  const padsReset = kb.resetBindingsForKind(b, "pad");
  assert.equal(json(padsReset["job.stop"]), json([]));
  assert.ok(!padsReset["jog.xPlus"].includes("Pad.HatE"));
  assert.ok(padsReset["jog.xPlus"].includes("ArrowRight"));
  assert.equal(padsReset["jog.xMinus"].includes("ArrowLeft"), false, "a removed key stays removed");
});

test("activation point and dead band are the person's to tune", () => {
  const state = new pad.GamepadInputState();
  state.update([xbox()]);

  // more sensitive: 25% is enough
  state.setTuning({ activation: 0.25, deadband: 0.1 });
  assert.equal(json(sorted(state.update([withAxis(0, 0.3)]))), json(["Pad.A0+"]));
  // held until it is back within the 10% dead band
  assert.equal(json(sorted(state.update([withAxis(0, 0.15)]))), json(["Pad.A0+"]));
  assert.equal(state.update([withAxis(0, 0.05)]).size, 0);

  // less sensitive: 80% needed
  state.setTuning({ activation: 0.8, deadband: 0.5 });
  assert.equal(state.update([withAxis(0, 0.7)]).size, 0);
  assert.equal(json(sorted(state.update([withAxis(0, 0.85)]))), json(["Pad.A0+"]));
  assert.equal(json(sorted(state.update([withAxis(0, 0.6)]))), json(["Pad.A0+"]));
  assert.equal(state.update([withAxis(0, 0.4)]).size, 0);
});

test("axis travel is reported from rest, with the hat and bad readings as 0", () => {
  const state = new pad.GamepadInputState();
  state.update([xbox()]);
  state.update([withAxis(0, 0.4, withAxis(3, 0.2, withAxis(9, -0.429)))]);
  const [d] = state.axisDeltas();
  assert.ok(Math.abs(d[0] - 0.4) < 1e-9);
  assert.ok(Math.abs(d[3] - 1.2) < 1e-9, "a trigger resting at -1 reports travel from -1");
  assert.equal(d[9], 0);
  assert.equal(d.length, 10);
});
