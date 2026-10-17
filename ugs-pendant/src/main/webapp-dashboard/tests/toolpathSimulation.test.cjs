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

// Three 100 mm cuts at 600 mm/min: 10 s each, on lines 1, 5 and 9.
const events = () =>
  make([
    seg(0, 100, { feedRate: 600, lineNumber: 1 }),
    seg(100, 200, { feedRate: 600, lineNumber: 5 }),
    seg(200, 300, { feedRate: 600, lineNumber: 9 }),
  ]);
const playing = (sim) => {
  sim.setActive(true);
  sim.setSpeed(1);
  return sim;
};
const plain = (value) => JSON.parse(JSON.stringify(value));

test("a stop falls at the start of the first segment on or after its line, and playback holds there", () => {
  const sim = playing(events());
  sim.setEvents([{ line: 4, kind: "stop", text: "Tool change: T2" }]); // between the first and second cut
  assert.equal(sim.hasEvents(), true);
  sim.play();
  sim.update(8);
  assert.equal(sim.isPlaying(), true);
  assert.equal(sim.getNotice(), null);
  sim.update(5); // would reach 13 s; the stop is at 10 s
  close(sim.getElapsedSeconds(), 10);
  assert.equal(sim.isPlaying(), false);
  assert.deepEqual(plain(sim.getNotice()), { kind: "stop", text: "Tool change: T2", line: 4, paused: true });
});

test("Play carries on from a stop and the same stop does not trigger again", () => {
  const sim = playing(events());
  sim.setEvents([{ line: 5, kind: "stop", text: "Program stop (M0)" }]);
  sim.play();
  sim.update(12);
  close(sim.getElapsedSeconds(), 10);
  sim.play();
  assert.equal(sim.getNotice(), null);
  sim.update(5);
  close(sim.getElapsedSeconds(), 15);
  assert.equal(sim.isPlaying(), true);
});

test("with pausing off, a stop is announced but playback runs through", () => {
  const sim = playing(events());
  sim.setPauseAtStops(false);
  sim.setEvents([{ line: 5, kind: "stop", text: "Program stop (M0)" }]);
  sim.play();
  sim.update(12);
  close(sim.getElapsedSeconds(), 12);
  assert.equal(sim.isPlaying(), true);
  assert.equal(sim.getNotice().paused, false);
  assert.equal(sim.getNotice().text, "Program stop (M0)");
});

test("turning pausing off while held at a stop releases the notice's hold", () => {
  const sim = playing(events());
  sim.setEvents([{ line: 5, kind: "stop", text: "Program stop (M0)" }]);
  sim.play();
  sim.update(12);
  assert.equal(sim.getNotice().paused, true);
  sim.setPauseAtStops(false);
  assert.equal(sim.getNotice().paused, false);
});

test("a message never stops playback and fades after a few seconds", () => {
  const sim = playing(events());
  sim.setEvents([{ line: 5, kind: "message", text: "Clamp the board" }]);
  sim.play();
  sim.update(12);
  assert.equal(sim.isPlaying(), true);
  assert.equal(sim.getNotice().text, "Clamp the board");
  sim.update(4);
  assert.notEqual(sim.getNotice(), null);
  sim.update(2);
  assert.equal(sim.getNotice(), null);
});

test("seeking, restarting and stepping clear the notice; a new toolpath clears the events", () => {
  const sim = playing(events());
  sim.setEvents([{ line: 5, kind: "stop", text: "Program stop (M0)" }]);
  sim.play();
  sim.update(12);
  assert.notEqual(sim.getNotice(), null);
  sim.seek(0.9);
  assert.equal(sim.getNotice(), null);
  sim.seek(0);
  sim.play();
  sim.update(12);
  assert.notEqual(sim.getNotice(), null);
  sim.restart();
  assert.equal(sim.getNotice(), null);
  sim.setSegments([seg(0, 100, { feedRate: 600, lineNumber: 1 })], white);
  assert.equal(sim.hasEvents(), false);
});

test("an event after the last move happens at the very end; one before any move never stops anything", () => {
  const sim = playing(events());
  sim.setEvents([
    { line: 1, kind: "stop", text: "Tool change: T1" }, // at time 0
    { line: 99, kind: "stop", text: "Program stop (M0)" },
  ]);
  sim.play();
  sim.update(5);
  assert.equal(sim.isPlaying(), true); // not held at the start
  sim.update(100);
  close(sim.getElapsedSeconds(), 30);
  assert.equal(sim.getNotice().text, "Program stop (M0)");
  assert.equal(sim.getNotice().paused, true);
});

test("changing the rapid rate keeps events at the same spot in the program", () => {
  const sim = playing(
    make([
      seg(0, 100, { feedRate: 600, lineNumber: 1 }),
      seg(100, 200, { rapid: true, feedRate: 600, lineNumber: 2 }),
      seg(200, 300, { feedRate: 600, lineNumber: 3 }),
    ])
  );
  sim.setEvents([{ line: 3, kind: "stop", text: "Program stop (M0)" }]);
  sim.setRapidRate(6000);
  sim.play();
  sim.update(500);
  close(sim.getElapsedSeconds(), 10 + 1); // the cut, then the 100 mm rapid at 6000 mm/min
});

test("a message ahead of the first move is shown when playback starts, and a stop there does not hold it", () => {
  const sim = playing(events());
  sim.setEvents([
    { line: 1, kind: "message", text: "Clamp the stock" },
    { line: 1, kind: "stop", text: "Tool change: T1" },
  ]);
  assert.equal(sim.getNotice(), null);
  sim.play();
  assert.equal(sim.getNotice().text, "Clamp the stock");
  assert.equal(sim.getNotice().paused, false);
  sim.update(3);
  assert.equal(sim.isPlaying(), true);
  close(sim.getElapsedSeconds(), 3);
});

test("two stops at the same spot are held at together and shown as one", () => {
  const sim = playing(events());
  sim.setEvents([
    { line: 3, kind: "stop", text: "Program stop (M0): flip the board" },
    { line: 4, kind: "stop", text: "Tool change: T3" },
  ]);
  sim.play();
  sim.update(12);
  close(sim.getElapsedSeconds(), 10);
  assert.equal(sim.getNotice().text, "Program stop (M0): flip the board; Tool change: T3");
  sim.play();
  sim.update(2);
  assert.equal(sim.isPlaying(), true);
  assert.equal(sim.getNotice(), null);
});

test("stepping back over a stop lets playback hold at it again", () => {
  const sim = playing(events());
  sim.setEvents([{ line: 5, kind: "stop", text: "Program stop (M0)" }]);
  sim.play();
  sim.update(12);
  sim.seek(0.1);
  sim.play();
  sim.update(30);
  close(sim.getElapsedSeconds(), 10);
  assert.equal(sim.getNotice().paused, true);
});
