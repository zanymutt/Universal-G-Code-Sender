const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const sandbox = { window: {} };
vm.runInNewContext(fs.readFileSync(path.join(__dirname, "rotate.js"), "utf8"), sandbox);
const rotateGcode = sandbox.window.rotateGcode;

const NUM = "(-?\\d*\\.?\\d+)";
const word = (code, letter) => {
  const m = code.match(new RegExp(letter + NUM, "i"));
  return m ? parseFloat(m[1]) : null;
};

// A tiny G0-G3 follower: the tool position after every line that moves in XY,
// plus that line's arc I/J. It tracks G90/G91 and modal axes the way a
// controller does, which is exactly what the plugin's output has to survive.
function follow(text) {
  let x = 0, y = 0, absolute = true, motion = null;
  const steps = [];
  for (const raw of text.split(/\r?\n/)) {
    const code = raw.replace(/\(.*?\)/g, "").replace(/;.*/, "");
    if (/\bG91\b/i.test(code)) absolute = false;
    if (/\bG90\b/i.test(code)) absolute = true;
    const g = code.match(/\bG0*([0-3])(?![0-9])/i);
    if (g) motion = g[1];
    const nx = word(code, "X"), ny = word(code, "Y");
    if (motion === null || (nx === null && ny === null)) continue;
    x = nx === null ? x : absolute ? nx : x + nx;
    y = ny === null ? y : absolute ? ny : y + ny;
    steps.push({ x, y, i: word(code, "I"), j: word(code, "J"), absolute });
  }
  return steps;
}

const close = (a, b) => Math.abs(a - b) < 1e-3;
const turn = (px, py, cx, cy, deg) => {
  const a = (deg * Math.PI) / 180;
  const dx = px - cx, dy = py - cy;
  return [cx + dx * Math.cos(a) - dy * Math.sin(a), cy + dx * Math.sin(a) + dy * Math.cos(a)];
};

// Every step of the rotated program must land where a rigid turn of the original
// step would - endpoints about the pivot, arc centre offsets about the origin.
function assertRigidTurn(original, degrees, pivotMode) {
  const result = rotateGcode(original, degrees, pivotMode);
  const before = follow(original);
  const after = follow(result.text);
  assert.equal(after.length, before.length, "same number of moves");
  before.forEach((step, n) => {
    const [ex, ey] = turn(step.x, step.y, result.pivot.x, result.pivot.y, degrees);
    assert.ok(
      close(after[n].x, ex) && close(after[n].y, ey),
      `move ${n + 1}: expected (${ex.toFixed(3)}, ${ey.toFixed(3)}) got (${after[n].x}, ${after[n].y})`
    );
    if (step.i !== null || step.j !== null) {
      const [ei, ej] = turn(step.i ?? 0, step.j ?? 0, 0, 0, degrees);
      assert.ok(close(after[n].i ?? 0, ei) && close(after[n].j ?? 0, ej), `move ${n + 1}: arc offset`);
    }
  });
  return result;
}

const test = (name, fn) => {
  fn();
  console.log("PASS", name);
};

const sample = fs.readFileSync(
  path.join(__dirname, "../../src/main/webapp-dashboard/src/demo/samples/arcs-and-slot.nc"),
  "utf8"
);

test("the demo's arcs-and-slot program turns rigidly at every angle and pivot", () => {
  for (const degrees of [90, 30, -45, 180, 270]) {
    for (const pivot of ["origin", "center"]) assertRigidTurn(sample, degrees, pivot);
  }
});

test("a move naming one axis gets both, so an edge stays a straight line", () => {
  const out = rotateGcode("G90\nG1 X10 Y20 F100\nG1 X70\nY50\n", 90, "origin").text.split("\n");
  assert.equal(out[2], "G1 X-20 Y70");
  assert.equal(out[3], "X-50 Y70");
});

test("relative (G91) single-axis moves rotate their delta into both axes", () => {
  const program = "G91\nG1 X10 Y0 F100\nG1 X5\nY5\n";
  assertRigidTurn(program, 90, "origin");
  assert.equal(rotateGcode(program, 90, "origin").text.split("\n")[2], "G1 X0 Y5");
});

test("lines that aren't toolpath geometry are left exactly as written", () => {
  const program = "G21 G90 G54\nG53 G0 X5 Y5\nG10 L20 X0 Y0\nG4 P1\nM3 S1000\nG0 Z5\n";
  const result = rotateGcode(program, 45, "origin");
  assert.equal(result.text, program);
  assert.equal(result.rotatedLineCount, 0);
});

test("a rotation of zero degrees leaves coordinates unchanged", () => {
  const program = "G90\nG0 X10 Y20\nG1 X30 F100\n";
  const out = rotateGcode(program, 0, "origin").text;
  assert.deepEqual(follow(out).map((s) => [s.x, s.y]), follow(program).map((s) => [s.x, s.y]));
});

test("toolpath center counts how far arcs bulge, not just where moves end", () => {
  // Circle x 20..60 y 10..50; the slot's half-circle ends reach x 5 and 75 (y 60..70);
  // the park move touches the origin - so the extents are x 0..75, y 0..70. End
  // points alone stop at x 70 and would put the center at (35, 35).
  const pivot = rotateGcode(sample, 90, "center").pivot;
  assert.ok(close(pivot.x, 37.5) && close(pivot.y, 35), JSON.stringify(pivot));
});

test("arc extents follow the arc's direction and only what it sweeps", () => {
  // Quarter turns from (10,0) around the origin: counter-clockwise reaches y=10 only,
  // clockwise sweeps three quarters and reaches x=-10 and y=-10 too.
  const ccw = rotateGcode("G90 G17\nG0 X10 Y0\nG3 X0 Y10 I-10 J0\n", 0, "center").pivot;
  assert.ok(close(ccw.x, 5) && close(ccw.y, 5), JSON.stringify(ccw));
  const cw = rotateGcode("G90 G17\nG0 X10 Y0\nG2 X0 Y10 I-10 J0\n", 0, "center").pivot;
  assert.ok(close(cw.x, 0) && close(cw.y, 0), JSON.stringify(cw));
});
