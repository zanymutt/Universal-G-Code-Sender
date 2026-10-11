const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const ts = require("typescript");
const vm = require("node:vm");
const source = fs.readFileSync(path.join(__dirname, "../src/utils/pluginPanes.ts"), "utf8");
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText;
const sandbox = { exports: {} };
vm.runInNewContext(compiled, sandbox);
const { pluginContent, pluginIdFromContent, paneDockSlot, paneContentLabel, planPluginDocking } = sandbox.exports;
// The module runs in a vm context, so compare via JSON rather than deepEqual.
const json = (v) => JSON.stringify(v);

const nesting = { id: "nesting", name: "Nesting" };
const thc = { id: "thc", name: "THC" };
const win = (key, id, dockSlot = null) => ({ key, plugin: { id }, dockSlot });

test("content strings round-trip and only plugin ones parse", () => {
  assert.equal(pluginContent("nesting"), "plugin:nesting");
  assert.equal(pluginIdFromContent("plugin:nesting"), "nesting");
  assert.equal(pluginIdFromContent("visualize"), null);
  assert.equal(pluginIdFromContent("plugin:"), null);
  assert.equal(paneDockSlot(3), "pane-3");
});
test("labels: built-ins by name, plugins by name or id", () => {
  assert.equal(paneContentLabel("macros"), "Macros");
  assert.equal(paneContentLabel("plugin:nesting", "Nesting"), "Nesting");
  assert.equal(paneContentLabel("plugin:nesting"), "nesting");
});
test("a pane naming an installed plugin that has no window gets it docked", () => {
  const plan = planPluginDocking([{ id: 1, content: "visualize" }, { id: 2, content: "plugin:nesting" }], [nesting], []);
  assert.equal(json(plan.dock.map(d => [d.plugin.id, d.slot])), json([["nesting", "pane-2"]]));
  assert.equal(plan.park.length, 0);
});
test("planning is idempotent once the windows match", () => {
  const plan = planPluginDocking([{ id: 2, content: "plugin:nesting" }], [nesting], [win(1, "nesting", "pane-2")]);
  assert.equal(plan.dock.length, 0);
  assert.equal(plan.park.length, 0);
});
test("a docked plugin whose pane now shows something else is parked, not closed", () => {
  const plan = planPluginDocking([{ id: 2, content: "visualize" }], [nesting], [win(7, "nesting", "pane-2")]);
  assert.equal(plan.dock.length, 0);
  assert.equal(json(plan.park), json([7]));
});
test("a plugin moved to another pane is re-docked there, not parked", () => {
  const plan = planPluginDocking([{ id: 3, content: "plugin:nesting" }], [nesting], [win(7, "nesting", "pane-2")]);
  assert.equal(json(plan.dock.map(d => d.slot)), json(["pane-3"]));
  assert.equal(plan.park.length, 0);
});
test("two panes naming one plugin: the first wins", () => {
  const plan = planPluginDocking(
    [{ id: 1, content: "plugin:thc" }, { id: 2, content: "plugin:thc" }], [thc], []);
  assert.equal(json(plan.dock.map(d => d.slot)), json(["pane-1"]));
});
test("a plugin that isn't installed is left alone (the pane shows a placeholder)", () => {
  const plan = planPluginDocking([{ id: 1, content: "plugin:gone" }], [nesting], []);
  assert.equal(plan.dock.length, 0);
  assert.equal(plan.park.length, 0);
});
test("different plugins in different panes both dock", () => {
  const plan = planPluginDocking(
    [{ id: 1, content: "plugin:nesting" }, { id: 2, content: "plugin:thc" }], [nesting, thc], []);
  assert.equal(plan.dock.length, 2);
});
