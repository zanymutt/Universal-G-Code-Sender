const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const ts = require("typescript");
const vm = require("node:vm");

// Same approach as pluginWindows.test.cjs (transpile the TS source and run it),
// except this module imports three, so it's given a real require for that.
const source = fs.readFileSync(path.join(__dirname, "../src/utils/toolpathSimulation.ts"), "utf8");
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText;
const sandbox = { exports: {}, require };
vm.runInNewContext(compiled, sandbox);
const { ToolpathSimulation, REAL_TIME_SPEEDS, QUICK_SPEEDS } = sandbox.exports;
const THREE = require("three");

const seg = (x0, x1, extra = {}) => ({
  start: { x: x0, y: 0, z: 0 },
  end: { x: x1, y: 0, z: 0 },
  rapid: false,
  arc: false,
  lineNumber: 0,
  ...extra,
});
const white = () => new THREE.Color("#fff");
const make = (segments) => {
  const sim = new ToolpathSimulation(new THREE.Scene());
  sim.setSegments(segments, white);
  return sim;
};
const close = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-6, `${actual} != ${expected}`);

test("cuts take length / feed, rapids take length / rapid rate (metric)", () => {
  const sim = make([seg(0, 100, { feedRate: 600 }), seg(100, 200, { rapid: true, feedRate: 600 })]);
  assert.equal(sim.isRealTiming(), true);
  close(sim.getTotalSeconds(), 10 + 2); // 100mm @ 600mm/min, 100mm @ 3000mm/min
});

test("inch files: feed is already in the coordinates' units, rapids convert to mm", () => {
  const sim = make([
    seg(0, 10, { feedRate: 60, inches: true }),
    seg(10, 20, { rapid: true, feedRate: 60, inches: true }),
  ]);
  close(sim.getTotalSeconds(), 10 + (254 / 3000) * 60);
});

test("changing the rapid rate keeps the playhead at the same fraction of the job", () => {
  const sim = make([seg(0, 100, { feedRate: 600 }), seg(100, 200, { rapid: true, feedRate: 600 })]);
  sim.setActive(true);
  sim.seek(0.5);
  sim.setRapidRate(6000);
  close(sim.getTotalSeconds(), 10 + 1);
  close(sim.getProgress(), 0.5);
});

test("no feed data falls back to the uniform stand-in clock", () => {
  const sim = make([seg(0, 100), seg(100, 125, { rapid: true })]);
  assert.equal(sim.isRealTiming(), false);
  assert.deepEqual(sim.getSpeeds(), QUICK_SPEEDS);
  close(sim.getTotalSeconds(), 100 + 25 * 0.25);
});

test("a cut before any F word borrows the file's first feed instead of taking no time", () => {
  const sim = make([seg(0, 60, { feedRate: 0 }), seg(60, 120, { feedRate: 600 })]);
  close(sim.getTotalSeconds(), 12);
});

test("default real-time speed is the slowest preset that fits the job in about a minute", () => {
  assert.equal(make([seg(0, 500, { feedRate: 1000 })]).getSpeed(), REAL_TIME_SPEEDS[0]); // 30s job
  const long = make([seg(0, 60000, { feedRate: 1000 })]); // 1 hour
  assert.equal(long.getSpeed(), 60);
});

test("stepping moves between line ends, and the current line is the last one started", () => {
  const sim = make([
    seg(0, 100, { feedRate: 600, lineNumber: 5 }),
    seg(100, 200, { feedRate: 600, lineNumber: 6 }),
    seg(200, 300, { feedRate: 600, lineNumber: 7 }),
  ]);
  sim.setActive(true);
  const state = () => [sim.getCurrentLine(), sim.getElapsedSeconds()];
  assert.deepEqual(state(), [0, 0]);
  sim.stepForward();
  assert.deepEqual(state(), [5, 10]);
  sim.stepForward();
  assert.deepEqual(state(), [6, 20]);
  sim.stepBack();
  assert.deepEqual(state(), [5, 10]);
  sim.stepBack();
  assert.deepEqual(state(), [0, 0]);
  sim.seek(0.5);
  assert.deepEqual(state(), [6, 15]);
});

test("hiding rapids draws only the cutting segments, still in program order", () => {
  const sim = make([
    seg(0, 10, { rapid: true, feedRate: 600, lineNumber: 1 }),
    seg(10, 20, { feedRate: 600, lineNumber: 2 }),
    seg(20, 30, { rapid: true, feedRate: 600, lineNumber: 3 }),
    seg(30, 40, { feedRate: 600, lineNumber: 4 }),
  ]);
  sim.setShowRapids(false);
  sim.setActive(true);
  const solid = sim.group.children.find((child) => child.isLineSegments && !child.material.transparent);
  assert.equal(solid.geometry.index.count, 4); // two cutting segments, two vertices each

  sim.seek(1);
  sim.update(0);
  assert.equal(solid.geometry.drawRange.count, 4);
  sim.stepBack();
  sim.stepBack(); // end of line 2: only the first cut is done
  sim.update(0);
  assert.equal(solid.geometry.drawRange.count, 2);
});
