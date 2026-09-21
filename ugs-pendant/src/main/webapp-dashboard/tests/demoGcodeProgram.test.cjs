const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const ts = require("typescript");
const vm = require("node:vm");

const source = fs.readFileSync(path.join(__dirname, "../src/demo/gcodeProgram.ts"), "utf8");
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText;
const sandbox = { exports: {}, Math, parseFloat, Number };
vm.runInNewContext(compiled, sandbox);
const { parseGcode, toolpathFrom } = sandbox.exports;

const close = (a, b, eps = 1e-6) => Math.abs(a - b) < eps;
// Values built inside the vm have their own Array/Object prototypes, which deepEqual treats as different.
const plain = (value) => JSON.parse(JSON.stringify(value));

test("linear moves are modal, carry the F word and 1-based source line numbers", () => {
  const program = parseGcode("; header\nG21 G90\nG0 Z5\nG1 X10 F300\nY5\n");
  const segs = program.segments;
  assert.equal(segs.length, 3);
  assert.deepEqual(plain(segs.map((s) => [s.rapid, s.lineNumber])), [[true, 3], [false, 4], [false, 5]]);
  assert.deepEqual({ ...segs[1].end }, { x: 10, y: 0, z: 5 });
  assert.deepEqual({ ...segs[2].end }, { x: 10, y: 5, z: 5 });
  assert.equal(segs[2].feedRate, 300);
});

test("comments, blank lines and macro/variable lines produce nothing", () => {
  const program = parseGcode("(hello)\n\n#1 = 5\nO100 sub\n; x\nG1 X[#1] Y2\n");
  assert.equal(program.segments.length, 0);
  assert.equal(program.commands.length, 0);
});

test("G91 relative moves accumulate from the start position", () => {
  const program = parseGcode("G91\nG1 X5 F100\nG1 X5\n", { start: { x: 1, y: 2, z: 3 } });
  assert.deepEqual({ ...program.segments[1].end }, { x: 11, y: 2, z: 3 });
});

test("an I/J arc and the equivalent R arc end at the same point and stay on the circle", () => {
  const ij = parseGcode("G0 X10 Y0\nG3 X0 Y10 I-10 J0 F100\n");
  const r = parseGcode("G0 X10 Y0\nG3 X0 Y10 R10 F100\n");
  for (const program of [ij, r]) {
    const arcs = program.segments.filter((s) => s.arc);
    assert.ok(arcs.length >= 4);
    const last = arcs[arcs.length - 1].end;
    assert.ok(close(last.x, 0) && close(last.y, 10));
    for (const s of arcs) assert.ok(close(Math.hypot(s.end.x, s.end.y), 10, 1e-4), JSON.stringify(s.end));
  }
});

test("clockwise vs counter-clockwise R arcs pick opposite sides", () => {
  const ccw = parseGcode("G0 X10 Y0\nG3 X0 Y10 R10\n").segments.filter((s) => s.arc);
  const cw = parseGcode("G0 X10 Y0\nG2 X0 Y10 R10\n").segments.filter((s) => s.arc);
  const mid = (arcs) => arcs[Math.floor(arcs.length / 2)].end;
  // Center (0,0) for CCW, so the mid-point bulges away from (10,10); CW's center is (10,10).
  assert.ok(mid(ccw).x + mid(ccw).y > 10, "ccw arc bulges outward");
  assert.ok(mid(cw).x + mid(cw).y < 10, "cw arc bulges inward");
});

test("a full circle (start = end) sweeps a whole turn", () => {
  const program = parseGcode("G0 X10 Y0\nG2 X10 Y0 I-10 J0 F100\n");
  const arcs = program.segments.filter((s) => s.arc);
  assert.ok(arcs.length >= 64);
  assert.ok(arcs.some((s) => s.end.x < -9), "reaches the far side");
});

test("effects and dwell are recorded on their own commands", () => {
  const program = parseGcode("M3 S1200\nG4 P2\nG1 Z-1 F100\nM5\nM8\n");
  const kinds = program.commands.map((c) => c.effects.map((e) => e.kind + (e.mode ? ":" + e.mode : "")));
  assert.deepEqual(plain(kinds), [["spindle:M3", "spindleSpeed"], [], [], ["spindle:M5"], ["coolant:M8"]]);
  assert.equal(program.commands[1].dwellSeconds, 2);
});

test("units are flagged per segment", () => {
  const program = parseGcode("G20\nG1 X1 F10\n");
  assert.equal(program.segments[0].inches, true);
});

test("toolpathFrom drops earlier lines and adds a plunge from above the first kept move", () => {
  const program = parseGcode("G0 X0 Y0 Z5\nG1 Z-1 F100\nG1 X10\nG1 X20\n");
  const path = toolpathFrom(program, 3);
  assert.equal(path.length, 3);
  assert.ok(close(path[0].start.z, -1 + 10) && close(path[0].end.z, -1));
  assert.deepEqual(plain(path.slice(1).map((s) => s.lineNumber)), [3, 4]);
  assert.equal(toolpathFrom(program, 1), program.segments);
});
