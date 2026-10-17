const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const ts = require("typescript");
const vm = require("node:vm");

const source = fs.readFileSync(path.join(__dirname, "../src/utils/floatingPanel.ts"), "utf8");
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText;
const sandbox = { exports: {}, Math };
vm.runInNewContext(compiled, sandbox);
const { placeFloatingPanel, clampPanelPosition } = sandbox.exports;
const plain = (value) => JSON.parse(JSON.stringify(value));

const viewport = { width: 1200, height: 800 };

test("the panel opens beside the anchor when the whole width fits", () => {
  const anchor = { left: 100, top: 120, right: 380, bottom: 700 };
  const placed = plain(placeFloatingPanel(anchor, { width: 700, height: 400 }, viewport));
  assert.equal(placed.left, 388);
  assert.equal(placed.top, 120);
  assert.equal(placed.width, 700);
  assert.equal(placed.maxHeight, 800 - 120 - 8);
});

test("without room beside it, the panel tucks into the top right", () => {
  const anchor = { left: 700, top: 120, right: 980, bottom: 700 };
  const placed = plain(placeFloatingPanel(anchor, { width: 700, height: 400 }, viewport));
  assert.equal(placed.left, 1200 - 8 - 700);
  assert.equal(placed.top, 8);
});

test("no anchor behaves the same as no room", () => {
  const placed = plain(placeFloatingPanel(null, { width: 500, height: 300 }, viewport));
  assert.equal(placed.left, 1200 - 8 - 500);
  assert.equal(placed.top, 8);
});

test("a narrow viewport shrinks the panel and a low anchor still leaves room to show it", () => {
  const narrow = plain(placeFloatingPanel(null, { width: 700, height: 400 }, { width: 400, height: 600 }));
  assert.equal(narrow.width, 384);
  assert.equal(narrow.left, 8);
  const low = plain(placeFloatingPanel({ left: 0, top: 750, right: 100, bottom: 790 }, { width: 300, height: 400 }, viewport));
  assert.ok(low.top <= 800 - 8 - 160);
  assert.ok(low.maxHeight >= 160);
});

test("dragging cannot lose the header off the screen", () => {
  const far = plain(clampPanelPosition(5000, 5000, 700, viewport));
  assert.equal(far.left, 1200 - 96);
  assert.equal(far.top, 800 - 44);
  const near = plain(clampPanelPosition(-5000, -5000, 700, viewport));
  assert.equal(near.left, 96 - 700);
  assert.equal(near.top, 0);
  const ok = plain(clampPanelPosition(300, 200, 700, viewport));
  assert.deepEqual(ok, { left: 300, top: 200 });
});
