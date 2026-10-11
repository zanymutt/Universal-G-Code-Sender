const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const ts = require("typescript");
const vm = require("node:vm");

const source = fs.readFileSync(path.join(__dirname, "../src/utils/pluginWindowGeometry.ts"), "utf8");
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText;
const sandbox = { exports: {}, Math };
vm.runInNewContext(compiled, sandbox);
const { resizeBox, moveBox } = sandbox.exports;
// The module runs in a vm context, so compare via JSON rather than deepEqual.
const json = (v) => JSON.stringify(v);

const viewport = { width: 1000, height: 800 };
const start = { left: 100, top: 50, width: 400, height: 300 };

test("east and south grow the window without moving it", () => {
  assert.equal(json(resizeBox(start, "e", 80, 0, viewport)), json({ left: 100, top: 50, width: 480, height: 300 }));
  assert.equal(json(resizeBox(start, "s", 0, 60, viewport)), json({ left: 100, top: 50, width: 400, height: 360 }));
  assert.equal(json(resizeBox(start, "se", 30, 40, viewport)), json({ left: 100, top: 50, width: 430, height: 340 }));
});

test("west moves the left edge and keeps the right edge fixed", () => {
  const next = resizeBox(start, "w", -50, 0, viewport);
  assert.equal(next.width, 450);
  assert.equal(next.left, 50);
  assert.equal(next.left + next.width, start.left + start.width);
  const shrunk = resizeBox(start, "w", 120, 0, viewport);
  assert.equal(shrunk.width, 280);
  assert.equal(shrunk.left + shrunk.width, 500);
});

test("south-west combines both", () => {
  const next = resizeBox(start, "sw", -40, 25, viewport);
  assert.equal(json(next), json({ left: 60, top: 50, width: 440, height: 325 }));
});

test("never smaller than the minimum, and the fixed edge stays fixed when clamped", () => {
  const e = resizeBox(start, "e", -5000, 0, viewport);
  assert.equal(e.width, 220);
  const w = resizeBox(start, "w", 5000, 0, viewport);
  assert.equal(w.width, 220);
  assert.equal(w.left + w.width, 500);
  assert.equal(resizeBox(start, "s", 0, -5000, viewport).height, 160);
});

test("never larger than its share of the viewport", () => {
  assert.equal(resizeBox(start, "e", 5000, 0, viewport).width, 960);
  assert.equal(resizeBox(start, "s", 0, 5000, viewport).height, 720);
  const w = resizeBox(start, "w", -5000, 0, viewport);
  assert.equal(w.width, 960);
  assert.equal(w.left + w.width, 500);
});

test("the top never moves under any resize", () => {
  for (const dir of ["e", "w", "s", "se", "sw"]) {
    assert.equal(resizeBox(start, dir, 30, 30, viewport).top, 50, dir);
  }
});

test("moving keeps part of the header reachable", () => {
  const size = { width: 400 };
  assert.equal(json(moveBox({ left: 100, top: 50 }, size, 20, 10, viewport)), json({ left: 120, top: 60 }));
  const off = moveBox({ left: 100, top: 50 }, size, -5000, -5000, viewport);
  assert.equal(off.left, 80 - 400);
  assert.equal(off.top, 0);
  const far = moveBox({ left: 100, top: 50 }, size, 5000, 5000, viewport);
  assert.equal(far.left, 920);
  assert.equal(far.top, 764);
});

test("a window wider than the viewport can still be pulled back on", () => {
  const next = moveBox({ left: 0, top: 0 }, { width: 2000 }, -10, 0, viewport);
  assert.ok(next.left >= 80 - 2000);
});
