const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const ts = require("typescript");
const vm = require("node:vm");

const source = fs.readFileSync(path.join(__dirname, "../src/utils/pluginPins.ts"), "utf8");
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: "ES2020" } }).outputText;
const sandbox = { exports: {}, Set, Math, Array, String, RegExp };
vm.runInNewContext(compiled, sandbox);
const p = sandbox.exports;
const json = (v) => JSON.stringify(v);

const plugins = [
  { id: "batch-runner", name: "Batch Runner", description: "Queue up multiple gcode files" },
  { id: "job-inspector", name: "Job Inspector", description: "Show machine state and count lines" },
  { id: "nesting", name: "Nesting", description: "Nest requested copies of G-code parts" },
  { id: "thc", name: "THC Control Panel", description: "Live control and datalog" },
];

test("everything is pinned until the person unpins it, and new plugins arrive pinned", () => {
  assert.equal(json(p.pinnedPlugins(plugins, []).map((x) => x.id)), json(plugins.map((x) => x.id)));
  const unpinned = p.togglePin([], "nesting");
  assert.equal(json(p.pinnedPlugins(plugins, unpinned).map((x) => x.id)), json(["batch-runner", "job-inspector", "thc"]));
  // a plugin installed later is not in the unpinned list, so it is pinned
  const withNew = [...plugins, { id: "brand-new", name: "Brand New" }];
  assert.ok(p.pinnedPlugins(withNew, unpinned).some((x) => x.id === "brand-new"));
});

test("pinning toggles and never mutates the list it was given", () => {
  const start = ["a"];
  const next = p.togglePin(start, "b");
  assert.equal(json(start), json(["a"]));
  assert.equal(json(next), json(["a", "b"]));
  assert.equal(json(p.togglePin(next, "a")), json(["b"]));
  assert.equal(p.isPinned(next, "c"), true);
  assert.equal(p.isPinned(next, "b"), false);
});

test("stored id lists are cleaned: strings only, no duplicates, bounded", () => {
  assert.equal(json(p.parseIdList(["a", "a", 5, null, "", "b"])), json(["a", "b"]));
  assert.equal(json(p.parseIdList("nope")), json([]));
  assert.equal(json(p.parseIdList(null)), json([]));
  assert.equal(p.parseIdList(Array.from({ length: 500 }, (_, i) => `id${i}`)).length, 200);
});

test("tile mode defaults to names and only 'icons' turns icons on", () => {
  assert.equal(p.parseTileMode(null), "names");
  assert.equal(p.parseTileMode("anything"), "names");
  assert.equal(p.parseTileMode("icons"), "icons");
});

test("search needs every word, in the name or the description", () => {
  const ids = (q) => p.filterPlugins(plugins, q).map((x) => x.id);
  assert.equal(json(ids("")), json(plugins.map((x) => x.id)));
  assert.equal(json(ids("nest")), json(["nesting"]));
  assert.equal(json(ids("gcode queue")), json(["batch-runner"]));
  assert.equal(json(ids("LIVE datalog")), json(["thc"]));
  assert.equal(json(ids("zzz")), json([]));
});

test("initials give an icon-less plugin a recognisable tile", () => {
  assert.equal(p.pluginInitials("THC Control Panel"), "TC");
  assert.equal(p.pluginInitials("Batch Runner"), "BR");
  assert.equal(p.pluginInitials("Nesting"), "Ne");
  assert.equal(p.pluginInitials("rotate-gcode"), "RG");
  assert.equal(p.pluginInitials("X"), "X");
  assert.equal(p.pluginInitials("   "), "?");
  assert.equal(p.pluginInitials("***"), "?");
});

test("the tile colour is stable per id and in range", () => {
  assert.equal(p.pluginHue("thc"), p.pluginHue("thc"));
  for (const id of ["thc", "nesting", "batch-runner", "", "a-much-longer-plugin-identifier"]) {
    const hue = p.pluginHue(id);
    assert.ok(Number.isInteger(hue) && hue >= 0 && hue < 360, `${id}: ${hue}`);
  }
  assert.notEqual(p.pluginHue("nesting"), p.pluginHue("batch-runner"));
});

test("sections fold and unfold", () => {
  assert.equal(json(p.toggleCollapsed([], "macros")), json(["macros"]));
  assert.equal(json(p.toggleCollapsed(["macros", "plugins"], "macros")), json(["plugins"]));
});
