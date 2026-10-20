const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const ts = require("typescript");
const vm = require("node:vm");

const load = (file) => {
  const source = fs.readFileSync(path.join(__dirname, "../src/utils", file), "utf8");
  const compiled = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText;
  const sandbox = { exports: {}, Math, Number, Int32Array, Float32Array, Uint8Array, Set, Map, Object, String, JSON, Infinity };
  vm.runInNewContext(compiled, sandbox);
  return sandbox.exports;
};

const P = load("plotterEngine.ts");
const T = load("toolTable.ts");

const plain = (value) => JSON.parse(JSON.stringify(value));

// A packed toolpath from [x0, y0, z0, x1, y1, z1, rapid] rows.
const pack = (rows, inches = false) => ({
  coords: Float32Array.from(rows.flatMap((row) => row.slice(0, 6))),
  rapid: Uint8Array.from(rows.map((row) => row[6] ?? 0)),
  power: new Float32Array(rows.length),
  tool: new Int32Array(rows.length).fill(-1),
  inches,
});

test("a Plotter Studio pen comment gives the pen's number, name and color", () => {
  assert.deepEqual(plain(T.describePen("Pen 3: orange #f99e0e")), { tool: 3, name: "orange", color: "#f99e0e" });
  assert.deepEqual(plain(T.describePen("MSG, Load pen 6: red #B41529")), { tool: 6, name: "red", color: "#b41529" });
  assert.deepEqual(plain(T.describePen("Pen 4: dark green #154c2a")), { tool: 4, name: "dark green", color: "#154c2a" });
  assert.deepEqual(plain(T.describePen("Pen 2: fineliner")), { tool: 2, name: "fineliner" });
  assert.deepEqual(plain(T.describePen("just a note")), {});
});

test("the file scan attaches each pen comment to its tool change", () => {
  const text = [
    "(Plotter Studio - millimeters)",
    "G21",
    "(Pen 3: orange #f99e0e)",
    "T3 M6 (MSG, Load pen 3: orange #f99e0e)",
    "G1 X1 Y1",
    "(Pen 1: black #010001)",
    "T1 M6 (MSG, Load pen 1: black #010001)",
    "G1 X2 Y2",
  ].join("\n");
  const scan = T.scanTools(text);
  assert.deepEqual(plain(scan.changes), [
    { line: 4, tool: 3 },
    { line: 7, tool: 1 },
  ]);
  assert.equal(scan.hints[3].color, "#f99e0e");
  assert.equal(scan.hints[3].name, "orange");
  assert.equal(scan.hints[1].color, "#010001");
  // The pen table starts from the file's colors, and the user's own edit still wins.
  const base = { shape: "flat", diameter: 0.5, vAngle: 60, cornerRadius: 0, tipDiameter: 0 };
  const rows = T.buildToolRows(scan, {}, base);
  assert.equal(rows.find((row) => row.tool === 3).color, "#f99e0e");
  assert.equal(rows.find((row) => row.tool === 3).name, "orange");
  assert.equal(rows.find((row) => row.tool === 3).cutter.diameter, 0.5);
  const edited = T.buildToolRows(scan, { 3: { color: "#112233" } }, base);
  assert.equal(edited.find((row) => row.tool === 3).color, "#112233");
});

test("ink is a feed move at or below the paper that goes somewhere", () => {
  const packed = pack([
    [0, 0, 5, 10, 0, 5, 1], // rapid travel
    [10, 0, 5, 10, 0, -2], // pen touching down: not a mark
    [10, 0, -2, 20, 0, -2], // drawing, with pressure
    [20, 0, 0, 30, 0, 0], // drawing exactly at the surface
    [30, 0, 0, 40, 0, 3], // lifting off
    [40, 0, -2, 50, 0, -2, 1], // a rapid never draws, even down
  ]);
  const scan = P.scanInk(packed, 0);
  assert.deepEqual(Array.from(scan.ink), [0, 0, 1, 1, 0, 0]);
  assert.equal(scan.count, 2);
  assert.deepEqual(plain(scan.bounds), { minX: 10, minY: 0, maxX: 30, maxY: 0 });
});

test("a raised paper surface counts: the pen draws at or below it", () => {
  const packed = pack([[0, 0, 1, 5, 0, 1]]);
  assert.equal(P.scanInk(packed, 0).count, 0);
  assert.equal(P.scanInk(packed, 1).count, 1);
});

test("inch files are measured in millimeters", () => {
  const packed = pack([[0, 0, -0.1, 2, 1, -0.1]], true);
  const { bounds } = P.scanInk(packed, 0);
  assert.ok(Math.abs(bounds.maxX - 50.8) < 1e-4 && Math.abs(bounds.maxY - 25.4) < 1e-4);
});

test("a fit sheet is the drawing plus the border", () => {
  const bounds = { minX: 10, minY: 20, maxX: 110, maxY: 70 };
  const plan = P.planPaper(bounds, 10, P.DEFAULT_PLOTTER_OPTIONS, 0.25, 4_000_000);
  assert.deepEqual([plan.x, plan.y, plan.width, plan.height], [0, 10, 120, 70]);
  assert.equal(plan.pxPerMm, 4);
  assert.deepEqual([plan.cols, plan.rows], [480, 280]);
  assert.equal(plan.coarsened, false);
});

test("a real sheet sits where it is told and turns on its side", () => {
  const bounds = { minX: 10, minY: 20, maxX: 110, maxY: 70 };
  const a4 = { ...P.DEFAULT_PLOTTER_OPTIONS, sheet: "a4", x: -5, y: 3 };
  const plan = P.planPaper(bounds, 10, a4, 0.5, 4_000_000);
  assert.deepEqual([plan.x, plan.y, plan.width, plan.height], [-5, 3, 210, 297]);
  const side = P.planPaper(bounds, 10, { ...a4, landscape: true }, 0.5, 4_000_000);
  assert.deepEqual([side.width, side.height], [297, 210]);
  const custom = P.planPaper(bounds, 10, { ...a4, sheet: "custom", width: 100, height: 50 }, 0.5, 4_000_000);
  assert.deepEqual([custom.width, custom.height], [100, 50]);
});

test("the picture is coarsened to stay inside the pixel budget", () => {
  const bounds = { minX: 0, minY: 0, maxX: 1000, maxY: 1000 };
  const plan = P.planPaper(bounds, 0, P.DEFAULT_PLOTTER_OPTIONS, 0.05, 1_000_000);
  assert.equal(plan.coarsened, true);
  assert.ok(plan.cols * plan.rows <= 1_000_000 * 1.01);
  assert.ok(plan.pxPerMm < 20);
});

test("the automatic pixel size follows the thinnest pen", () => {
  assert.equal(P.autoPlotterCell([0.5, 0.3], 0.5), 0.15);
  assert.equal(P.autoPlotterCell([], 0.5), 0.25);
  assert.equal(P.autoPlotterCell([0.01], 0.5), 0.05);
  assert.equal(P.autoPlotterCell([20], 0.5), 1);
});

test("stored paper options are put back into range", () => {
  const options = P.sanitizePlotterOptions({ paperColor: "nope", sheet: "banner", width: -4, x: 1e9, landscape: true });
  assert.equal(options.paperColor, "#ffffff");
  assert.equal(options.sheet, "fit");
  assert.equal(options.width, 1);
  assert.equal(options.x, 10000);
  assert.equal(options.landscape, true);
  assert.deepEqual(plain(P.sanitizePlotterOptions(undefined)), plain(P.DEFAULT_PLOTTER_OPTIONS));
  assert.equal(P.sanitizePlotterOptions({ paperColor: "#FFF0E0" }).paperColor, "#fff0e0");
});
