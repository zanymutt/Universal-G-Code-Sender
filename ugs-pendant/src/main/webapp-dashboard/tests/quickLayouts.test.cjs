const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const ts = require("typescript");
const vm = require("node:vm");

// Transpile a src file (path relative to src/) and run it in a vm; `deps` supplies its requires.
const load = (rel, deps = {}) => {
  const source = fs.readFileSync(path.join(__dirname, "../src", `${rel}.ts`), "utf8");
  const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: "ES2020" } }).outputText;
  const sandbox = {
    exports: {}, require: (p) => deps[p],
    Number, Math, Set, Map, Object, Array, JSON, RegExp, String, Boolean,
  };
  vm.runInNewContext(compiled, sandbox);
  return sandbox.exports;
};

const reactStub = { useEffect() {}, useState() {} };
const sizingModule = load("hooks/useDashboardSizing", { react: reactStub });
const shape = load("utils/paneLayoutShape");
const q = load("utils/quickLayouts", {
  "../hooks/useDashboardSizing": sizingModule,
  "./paneLayoutShape": shape,
});
const json = (v) => JSON.stringify(v);

const panes = (contents = ["visualize", "console"]) => ({
  panes: contents.map((content, i) => ({ id: i + 1, content, rect: { x0: i / contents.length, x1: (i + 1) / contents.length, y0: 0, y1: 1 } })),
  sizes: { a: 0.5 },
  spine: "vertical",
});
const sizing = (extra = {}) => ({ compact: false, leftWidth: 360, rightWidth: 360, layoutMode: "auto", ...extra });

test("always four slots, empty when nothing is stored", () => {
  assert.equal(q.QUICK_SLOT_COUNT, 4);
  assert.equal(json(q.parseQuickSlots(null)), json([null, null, null, null]));
  assert.equal(json(q.parseQuickSlots("nope")), json([null, null, null, null]));
  assert.equal(q.parseQuickSlots([null]).length, 4);
  assert.equal(q.parseQuickSlots(new Array(9).fill(null)).length, 4);
});

test("a slot round-trips and keeps its colour, sizing, zoom and panes", () => {
  const slot = q.makeQuickSlot("orange", sizing({ compact: true, leftWidth: 300 }), 110, panes());
  const parsed = q.parseQuickSlots(JSON.parse(JSON.stringify([null, slot, null, null])));
  assert.equal(parsed[0], null);
  assert.equal(parsed[1].color, "orange");
  assert.equal(parsed[1].zoom, 110);
  assert.equal(parsed[1].sizing.compact, true);
  assert.equal(parsed[1].sizing.leftWidth, 300);
  assert.equal(json(parsed[1].panes), json(panes()));
});

test("bad entries become empty without disturbing the others", () => {
  const good = q.makeQuickSlot("green", sizing(), 100, panes());
  const parsed = q.parseQuickSlots([
    { color: "green", sizing: sizing(), zoom: 5, panes: panes() }, // zoom out of range
    good,
    "junk",
    { color: "nonsense", sizing: { leftWidth: 99999 }, zoom: 100, panes: { panes: [] } },
  ]);
  assert.equal(parsed[0], null);
  assert.equal(parsed[1].color, "green");
  assert.equal(parsed[2], null);
  // an unknown colour falls back, sizing is clamped, and a broken pane layout is dropped (not the slot)
  assert.equal(parsed[3].color, "blue");
  assert.equal(parsed[3].sizing.leftWidth, 420);
  assert.equal(parsed[3].panes, null);
});

test("a slot made with no saved pane layout recalls without touching the panes", () => {
  const slot = q.makeQuickSlot("blue", sizing(), 100, null);
  assert.equal(slot.panes, null);
  assert.equal(q.quickSlotMatches(slot, sizing(), 100, panes()), true);
});

test("a slot is marked active only while everything matches", () => {
  const slot = q.makeQuickSlot("teal", sizing({ leftWidth: 300 }), 105, panes());
  assert.equal(q.quickSlotMatches(slot, sizing({ leftWidth: 300 }), 105, panes()), true);
  assert.equal(q.quickSlotMatches(slot, sizing({ leftWidth: 320 }), 105, panes()), false, "column width differs");
  assert.equal(q.quickSlotMatches(slot, sizing({ leftWidth: 300 }), 100, panes()), false, "zoom differs");
  assert.equal(q.quickSlotMatches(slot, sizing({ leftWidth: 300 }), 105, panes(["edit", "console"])), false, "panes differ");
  assert.equal(q.quickSlotMatches(null, sizing(), 100, panes()), false);
});

test("colours: eight choices, each with a hex value", () => {
  assert.equal(q.QUICK_COLORS.length, 8);
  for (const c of q.QUICK_COLORS) assert.match(c.hex, /^#[0-9a-f]{6}$/);
  assert.equal(q.colorHex("red"), "#ef4444");
  assert.equal(q.colorHex("unknown"), "#3b82f6");
});
