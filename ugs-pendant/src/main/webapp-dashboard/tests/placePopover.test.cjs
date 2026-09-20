const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const ts = require("typescript");
const vm = require("node:vm");

const source = fs.readFileSync(path.join(__dirname, "../src/utils/placePopover.ts"), "utf8");
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText;
const sandbox = { exports: {}, Math };
vm.runInNewContext(compiled, sandbox);
const { placePopover } = sandbox.exports;

const viewport = { width: 1000, height: 700 };
const anchorAt = (right, top) => ({ left: right - 40, right, top, bottom: top + 38 });
const content = { width: 260, height: 250 };

test("opens above the anchor, right-aligned, with no scrollbar when it fits", () => {
  const p = placePopover(anchorAt(600, 500), content, viewport);
  assert.equal(p.side, "above");
  assert.equal(p.maxHeight, null);
  assert.equal(p.left, 340);
  assert.equal(p.top, 500 - 6 - 250);
});

test("goes below when there is no room above but there is below", () => {
  const p = placePopover(anchorAt(600, 100), content, viewport);
  assert.equal(p.side, "below");
  assert.equal(p.maxHeight, null);
  assert.equal(p.top, 138 + 6);
});

test("an anchor near the left edge can't push it off screen", () => {
  const p = placePopover(anchorAt(120, 500), content, viewport);
  assert.equal(p.left, 8);
});

test("an anchor at the far right stays inside the viewport", () => {
  const p = placePopover(anchorAt(1200, 500), content, viewport);
  assert.equal(p.left + p.width, 1000 - 8);
});

test("a viewport narrower than the popover shrinks it to fit", () => {
  const p = placePopover(anchorAt(200, 500), content, { width: 200, height: 700 });
  assert.equal(p.width, 184);
  assert.equal(p.left, 8);
});

test("only scrolls when neither side can show it in full, using the roomier side", () => {
  const p = placePopover(anchorAt(600, 200), { width: 260, height: 600 }, { width: 1000, height: 500 });
  assert.equal(p.side, "below");
  assert.equal(p.top, 244);
  assert.equal(p.maxHeight, 500 - 238 - 6 - 8);
  assert.ok(p.top + p.maxHeight <= 500 - 8);
});
