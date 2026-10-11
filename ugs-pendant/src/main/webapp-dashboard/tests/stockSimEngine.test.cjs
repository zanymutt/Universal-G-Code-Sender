const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const ts = require("typescript");
const vm = require("node:vm");

const source = fs.readFileSync(path.join(__dirname, "../src/utils/stockSimEngine.ts"), "utf8");
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText;
const sandbox = { exports: {}, Math, Float32Array, Uint8Array, Number, Infinity };
vm.runInNewContext(compiled, sandbox);
const { DEFAULT_STOCK_SETTINGS, autoCellSize, packToolpath, planStockGrid, StockSimulator } = sandbox.exports;

const seg = (x0, y0, z0, x1, y1, z1, extra = {}) => ({
  start: { x: x0, y: y0, z: z0 },
  end: { x: x1, y: y1, z: z1 },
  rapid: false,
  ...extra,
});
const settings = (over = {}) => ({ ...DEFAULT_STOCK_SETTINGS, ...over });
const make = (segments, over = {}) => {
  const packed = packToolpath(segments);
  const s = settings(over);
  const grid = planStockGrid(packed, s);
  return { packed, grid, sim: grid && new StockSimulator(packed, s, grid) };
};
const at = (sim, x, y) => {
  const g = sim.grid;
  const i = Math.round((x - g.ox) / g.cell);
  const j = Math.round((y - g.oy) / g.cell);
  return sim.getHeights()[j * g.nx + i];
};

test("a flat endmill pass cuts a slot of its own diameter at the tip depth", () => {
  const { sim } = make([seg(0, 0, -2, 20, 0, -2)], { diameter: 6, cell: 0.25, thickness: 10 });
  sim.seek(1);
  assert.equal(at(sim, 10, 0), -2);
  assert.equal(at(sim, 10, 2.9), -2);
  assert.equal(at(sim, 10, 3.5), 0); // outside the 3 mm radius: untouched
  assert.equal(at(sim, 10, -3.5), 0);
});

test("a ball nose is deepest on the centre line and rises to the surface at its edge", () => {
  const { sim } = make([seg(0, 0, -3, 20, 0, -3)], { shape: "ball", diameter: 6, cell: 0.25, thickness: 10 });
  sim.seek(1);
  assert.equal(at(sim, 10, 0), -3);
  const edge = at(sim, 10, 2.75);
  assert.ok(edge > -3 && edge < 0, `edge ${edge}`);
  // Radius 3 sphere: at 2.75 off-centre the surface sits R - sqrt(R^2 - d^2) above the tip.
  assert.ok(Math.abs(edge - (-3 + 3 - Math.sqrt(9 - 2.75 * 2.75))) < 1e-4);
});

test("a V-bit's cut width follows its included angle", () => {
  const { sim } = make([seg(0, 0, -2, 20, 0, -2)], { shape: "v", vAngle: 90, diameter: 12, cell: 0.25, thickness: 10 });
  sim.seek(1);
  // 90 degrees: the wall rises 1 mm for every 1 mm sideways.
  assert.ok(Math.abs(at(sim, 10, 1) - -1) < 1e-4);
  assert.ok(Math.abs(at(sim, 10, 2) - 0) < 1e-4);
  assert.equal(at(sim, 10, 2.5), 0);
});

test("cuts are clamped at the bottom of the stock", () => {
  const { sim, grid } = make([seg(0, 0, -20, 10, 0, -20)], { thickness: 5, cell: 0.5 });
  sim.seek(1);
  assert.equal(grid.bottom, -5);
  assert.equal(at(sim, 5, 0), -5);
});

test("rapids and moves in the air never cut", () => {
  const { sim } = make(
    [seg(0, 0, 5, 20, 0, 5), seg(0, 0, -2, 20, 0, -2, { rapid: true }), seg(0, 5, -1, 20, 5, -1)],
    { cell: 0.5, thickness: 10 }
  );
  sim.seek(3);
  assert.equal(at(sim, 10, 0), 0);
  assert.equal(at(sim, 10, 5), -1);
});

test("passes accumulate, and the result does not depend on order", () => {
  const a = seg(0, 0, -1, 20, 0, -1);
  const b = seg(0, 0, -3, 20, 0, -3);
  const first = make([a, b], { cell: 0.5 }).sim;
  const second = make([b, a], { cell: 0.5 }).sim;
  first.seek(2);
  second.seek(2);
  assert.equal(at(first, 10, 0), -3);
  assert.deepEqual(Array.from(first.getHeights()), Array.from(second.getHeights()));
});

test("laser: power scales the depth, full power goes through, S0 is travel", () => {
  const { sim, grid } = make(
    [
      seg(0, 0, 0, 20, 0, 0, { spindleSpeed: 250 }),
      seg(0, 5, 0, 20, 5, 0, { spindleSpeed: 1000 }),
      seg(0, 10, 0, 20, 10, 0, { spindleSpeed: 0 }),
    ],
    { process: "laser", diameter: 0.4, cell: 0.1, thickness: 4 }
  );
  sim.seek(3);
  assert.equal(grid.bottom, -4);
  assert.ok(Math.abs(at(sim, 10, 0) - -1) < 1e-5); // 25% of 4 mm
  assert.equal(at(sim, 10, 5), -4); // full power: through
  assert.equal(at(sim, 10, 10), 0); // unpowered
  assert.equal(at(sim, 10, 0.5), 0); // kerf is only 0.4 wide
});

test("laser with no S words in the file cuts through", () => {
  const { sim } = make([seg(0, 0, 0, 20, 0, 0)], { process: "laser", diameter: 0.4, cell: 0.1 });
  sim.seek(1);
  assert.equal(at(sim, 10, 0), -3);
});

test("plasma always goes through while the torch is on", () => {
  const { sim } = make([seg(0, 0, 0, 20, 0, 0, { spindleSpeed: 5 })], { process: "plasma", diameter: 1.5, cell: 0.25 });
  sim.seek(1);
  assert.equal(at(sim, 10, 0), -3);
});

test("seeking backward gives exactly what a fresh run to that point gives", () => {
  const segments = [];
  for (let i = 0; i < 100; i++) segments.push(seg(0, i * 0.4, -(i % 5) - 0.5, 30, i * 0.4, -(i % 5) - 0.5));
  const { packed, grid } = make(segments, { diameter: 2, cell: 0.4, thickness: 8 });
  const s = settings({ diameter: 2, cell: 0.4, thickness: 8 });
  const scrubbed = new StockSimulator(packed, s, grid);
  scrubbed.seek(100);
  scrubbed.seek(37);
  const fresh = new StockSimulator(packed, s, grid);
  fresh.seek(37);
  assert.deepEqual(Array.from(scrubbed.getHeights()), Array.from(fresh.getHeights()));
  assert.equal(scrubbed.getIndex(), 37);
});

test("inch files: settings stay in mm but the grid is in the file's inches", () => {
  const { grid } = make([seg(0, 0, -0.1, 4, 0, -0.1, { inches: true })], { diameter: 6.35, margin: 25.4, cell: 0.254, thickness: 12.7 });
  assert.ok(Math.abs(grid.cell - 0.01) < 1e-9);
  assert.ok(Math.abs(grid.top - grid.bottom - 0.5) < 1e-9);
  assert.ok(Math.abs(grid.ox - (0 - 1 - 0.125)) < 1e-6);
});

test("a very fine cell size is coarsened to keep the grid affordable", () => {
  const { grid } = make([seg(0, 0, -1, 500, 400, -1)], { cell: 0.05 });
  assert.equal(grid.coarsened, true);
  assert.ok(grid.nx * grid.ny <= 2_000_000);
});

test("a toolpath with nothing that cuts has no stock", () => {
  const packed = packToolpath([seg(0, 0, 0, 10, 0, 0, { rapid: true })]);
  assert.equal(planStockGrid(packed, settings()), null);
});

test("a part-way fraction cuts only that far along the current move", () => {
  const { sim } = make([seg(0, 0, -2, 20, 0, -2)], { diameter: 2, cell: 0.25, thickness: 5 });
  sim.seek(0, 0.5);
  assert.equal(at(sim, 5, 0), -2);
  assert.equal(at(sim, 15, 0), 0);
  sim.seek(0, 1);
  assert.equal(at(sim, 15, 0), -2);
});

test("the part-way cut is exact once the segment completes and undone when moving back", () => {
  const segments = [seg(0, 0, -1, 20, 0, -1), seg(0, 4, -2, 20, 4, -2)];
  const { packed, grid } = make(segments, { diameter: 2, cell: 0.25, thickness: 5 });
  const s = settings({ diameter: 2, cell: 0.25, thickness: 5 });
  const sim = new StockSimulator(packed, s, grid);
  sim.seek(1, 0.6);
  sim.seek(1, 0.3); // less far into it: must not keep the 0.6 cut
  const fresh = new StockSimulator(packed, s, grid);
  fresh.seek(1, 0.3);
  assert.deepEqual(Array.from(sim.getHeights()), Array.from(fresh.getHeights()));
  sim.seek(2);
  const full = new StockSimulator(packed, s, grid);
  full.seek(2);
  assert.deepEqual(Array.from(sim.getHeights()), Array.from(full.getHeights()));
});

test("a kerf thinner than the grid still shows up wherever it falls", () => {
  for (const y of [0, 0.03, 0.05, 0.07, 0.1, 0.13, 0.17]) {
    const { sim, grid } = make([seg(0, y, 0, 20, y, 0, { spindleSpeed: 1000 })], { process: "laser", diameter: 0.1, cell: 0.2, thickness: 3 });
    sim.seek(1);
    const j = Math.round((y - grid.oy) / grid.cell);
    const near = Math.min(sim.getHeights()[j * grid.nx + 50], sim.getHeights()[(j + 1) * grid.nx + 50], sim.getHeights()[(j - 1) * grid.nx + 50]);
    assert.equal(near, -3, `line at y=${y}`);
  }
});

test("auto cell size follows the kerf for laser/plasma and the diameter for a router", () => {
  assert.ok(Math.abs(autoCellSize({ process: "laser", diameter: 0.2 }) - 0.1) < 1e-9);
  assert.ok(Math.abs(autoCellSize({ process: "plasma", diameter: 1.5 }) - 0.75) < 1e-9);
  assert.ok(Math.abs(autoCellSize({ process: "router", diameter: 6 }) - 0.6) < 1e-9);
  assert.equal(autoCellSize({ process: "laser", diameter: 0.001 }), 0.02);
  const { grid } = make([seg(0, 0, 0, 40, 0, 0, { spindleSpeed: 1 })], { process: "laser", diameter: 0.2, cell: 0 });
  assert.ok(Math.abs(grid.cell - 0.1) < 1e-9);
});

test("the cell limit is configurable: more cells keep a finer grid on a big part", () => {
  const big = [seg(0, 0, -1, 500, 400, -1)];
  const small = make(big, { cell: 0.1, maxCells: 1_000_000 }).grid;
  const large = make(big, { cell: 0.1, maxCells: 8_000_000 }).grid;
  assert.ok(small.nx * small.ny <= 1_000_000);
  assert.ok(large.nx * large.ny <= 8_000_000);
  assert.ok(large.cell < small.cell);
  assert.equal(small.coarsened, true);
});
