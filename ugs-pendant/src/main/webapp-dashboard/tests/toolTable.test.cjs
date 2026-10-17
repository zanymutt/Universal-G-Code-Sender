const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const ts = require("typescript");
const vm = require("node:vm");

const source = fs.readFileSync(path.join(__dirname, "../src/utils/toolTable.ts"), "utf8");
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText;
const sandbox = { exports: {}, Math, Number, Int32Array, Set, Map, Object, String, JSON };
vm.runInNewContext(compiled, sandbox);
const T = sandbox.exports;

const BASE = { shape: "flat", diameter: 6, vAngle: 60, cornerRadius: 1, tipDiameter: 0 };

test("a CamBam header gives the tool its diameter, and T0 M6 is the change", () => {
  const scan = T.scanTools("( Made using CamBam )\n( T0 : 3.175 )\nG21\n( T0 : 3.175 )\nT0 M6\nG1 X1\n");
  assert.deepEqual(JSON.parse(JSON.stringify(scan.changes)), [{ line: 5, tool: 0 }]);
  assert.equal(scan.hints[0].diameter, 3.175);
});

test("a header diameter in an inch file is converted to millimeters", () => {
  const scan = T.scanTools("G20\n( T1 : 0.25 )\nT1 M6\n");
  assert.ok(Math.abs(scan.hints[1].diameter - 6.35) < 1e-9);
});

test("M6 uses the T word selected before it, and the same tool again is not a change", () => {
  const scan = T.scanTools("T2\nM6\nG1 X1\nT2 M6\nM6 T3\n");
  assert.deepEqual(JSON.parse(JSON.stringify(scan.changes)), [
    { line: 2, tool: 2 },
    { line: 5, tool: 3 },
  ]);
});

test("a file that never uses M6 treats a bare T word as the change", () => {
  const scan = T.scanTools("T1\nG1 X1\nT4\nG1 X2\n");
  assert.deepEqual(JSON.parse(JSON.stringify(scan.changes)), [
    { line: 1, tool: 1 },
    { line: 3, tool: 4 },
  ]);
});

test("a T inside a comment is not a tool change", () => {
  const scan = T.scanTools("( T0 M6 )\n; T5\nG1 X1\n");
  assert.equal(scan.changes.length, 0);
});

test("free-form comments just before a change describe that tool", () => {
  const scan = T.scanTools('(1/8" ball nose)\nT2 M6\n(60 deg V-bit, 6 mm)\nT3 M6\n');
  assert.equal(scan.hints[2].shape, "ball");
  assert.ok(Math.abs(scan.hints[2].diameter - 3.175) < 1e-9);
  assert.equal(scan.hints[3].shape, "v");
  assert.equal(scan.hints[3].vAngle, 60);
  assert.equal(scan.hints[3].diameter, 6);
});

test("a comment that names its tool describes that tool wherever it is", () => {
  const scan = T.scanTools("(T4 - 2 mm bull nose)\nG1 X1\nT4 M6\n");
  assert.equal(scan.hints[4].shape, "bullnose");
  assert.equal(scan.hints[4].diameter, 2);
});

test("a description far from any change is ignored", () => {
  const scan = T.scanTools("(Bowl, 80 mm dia x 14 mm deep, 6 mm ball nose)\nG1 X1\nG1 X2\nG1 X3\nG1 X4\nT1\n");
  assert.equal(scan.hints[1], undefined);
});

test("a length that is a depth is not taken as the diameter", () => {
  const hint = T.describeCutter("12 mm long, 3 mm flat", false);
  assert.equal(hint.diameter, 3);
  assert.equal(hint.shape, "flat");
});

test("segments take the tool of the last change at or before their line", () => {
  const changes = [
    { line: 3, tool: 1 },
    { line: 10, tool: 2 },
  ];
  const tools = T.segmentToolNumbers([{ lineNumber: 1 }, { lineNumber: 3 }, { lineNumber: 9 }, { lineNumber: 10 }, { lineNumber: 99 }], changes);
  assert.deepEqual(Array.from(tools), [-1, 1, 1, 2, 2]);
  assert.deepEqual(Array.from(T.segmentToolNumbers([{ lineNumber: 5 }], [])), [-1]);
});

test("toolsUsed lists each cutting tool once, in order of first use, skipping rapids", () => {
  const used = T.toolsUsed(new Int32Array([2, 2, 5, -1, 7, 5]), (i) => i === 4);
  assert.deepEqual(Array.from(used), [2, 5]);
});

test("rows combine the file's tools with saved ones, and hints fill the default cutter", () => {
  const scan = T.scanTools("( T0 : 3.175 )\nT0 M6\n(60 deg V-bit)\nT1 M6\n");
  const rows = T.buildToolRows(scan, { 9: { cutter: { ...BASE, diameter: 2 } } }, BASE);
  assert.deepEqual(Array.from(rows.map((r) => r.tool)), [0, 1, 9]);
  assert.equal(rows[0].cutter.diameter, 3.175);
  assert.equal(rows[0].cutter.shape, "flat");
  assert.equal(rows[1].cutter.shape, "v");
  assert.equal(rows[1].inFile, true);
  assert.equal(rows[2].inFile, false);
  assert.equal(rows[2].edited, true);
  assert.equal(rows[0].edited, false);
  assert.match(rows[0].color, /^#[0-9a-f]{6}$/);
  assert.notEqual(rows[0].color, rows[1].color);
});

test("edit, reset, delete and restore go through the saved table", () => {
  const scan = T.scanTools("( T0 : 3.175 )\nT0 M6\n");
  let saved = {};
  const row = () => T.buildToolRows(scan, saved, BASE)[0];

  saved = T.setToolCutter(saved, 0, { ...BASE, shape: "ball", diameter: 4 });
  assert.equal(row().cutter.shape, "ball");
  assert.equal(row().edited, true);

  saved = T.setToolColor(saved, 0, "#112233");
  assert.equal(row().color, "#112233");

  saved = T.resetTool(saved, 0);
  assert.equal(row().cutter.diameter, 3.175); // back to what the file says
  assert.equal(row().edited, false);

  saved = T.setToolCutter(saved, 0, { ...BASE, diameter: 2 });
  saved = T.deleteTool(saved, 0, true);
  assert.equal(row().removed, true);
  assert.equal(row().edited, false);
  assert.equal(Object.keys(T.cutterTable(T.buildToolRows(scan, saved, BASE))).length, 0); // default cutter used

  saved = T.restoreTool(saved, 0);
  assert.equal(row().removed, false);
  assert.equal(row().cutter.diameter, 3.175);
  assert.equal(JSON.stringify(saved), "{}"); // nothing left to remember
});

test("deleting a tool that is only saved forgets it, and Add does not overwrite", () => {
  let saved = T.addTool({}, 7, BASE);
  assert.deepEqual(Object.keys(saved), ["7"]);
  const same = T.addTool(saved, 7, { ...BASE, diameter: 99 });
  assert.equal(same, saved);
  saved = T.deleteTool(saved, 7, false);
  assert.equal(JSON.stringify(saved), "{}");
});

test("addTool and cutterFromHint copy only the cutter's own fields", () => {
  const settingsLike = { ...BASE, process: "router", margin: 5, tools: {} };
  assert.deepEqual(Object.keys(T.addTool({}, 1, settingsLike)[1].cutter).sort(), Object.keys(BASE).sort());
  assert.deepEqual(Object.keys(T.cutterFromHint(settingsLike, undefined)).sort(), Object.keys(BASE).sort());
});

test("a taper ball hint gets a tip ball and a corner radius never exceeds the radius", () => {
  const taper = T.cutterFromHint(BASE, { tool: 1, shape: "taperball", diameter: 3 });
  assert.equal(taper.tipDiameter, 1);
  const small = T.cutterFromHint({ ...BASE, cornerRadius: 5 }, { tool: 1, diameter: 2 });
  assert.equal(small.cornerRadius, 1);
});

test("cutterSummary describes each shape in one line", () => {
  assert.equal(T.cutterSummary(BASE), "Flat 6 mm");
  assert.equal(T.cutterSummary({ ...BASE, shape: "ball", diameter: 3.175 }), "Ball nose 3.175 mm");
  assert.equal(T.cutterSummary({ ...BASE, shape: "v", diameter: 12 }), "V-bit 60°, 12 mm");
  assert.match(T.cutterSummary({ ...BASE, shape: "v", tipDiameter: 0.5 }), /^Chamfer/);
});

test("colors cycle through the palette by tool number", () => {
  assert.equal(T.defaultToolColor(0), T.TOOL_PALETTE[0]);
  assert.equal(T.defaultToolColor(T.TOOL_PALETTE.length), T.TOOL_PALETTE[0]);
  assert.equal(T.isHexColor("#a1B2c3"), true);
  assert.equal(T.isHexColor("red"), false);
});
