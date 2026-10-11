// Stock-removal simulation: a heightfield (2.5D) model of the block of material
// and what the cutter takes out of it. Pure computation with no DOM or three.js,
// so it runs in a Web Worker (stockSim.worker.ts) and is unit-testable in node.
//
// The stock is a grid of "material height" samples, all starting at the top of
// the stock. Each cutting move sweeps the cutter's footprint along its path and
// lowers every sample it covers to the cutter's tip height (plus the cutter's
// own profile - flat, ball or V - at that distance from the centre line). A
// sample only ever goes down, so passes accumulate and order doesn't matter.
//
// A heightfield can't represent undercuts (a T-slot, a dovetail, 4th/5th-axis
// work); for router, laser and plasma work on flat stock that's not a limit.

export type StockProcess = "router" | "laser" | "plasma";
export type StockShape = "flat" | "ball" | "v";

// All lengths are in millimetres here whatever units the file uses; the
// simulator converts to the file's own units.
export type StockSettings = {
  process: StockProcess;
  shape: StockShape;
  // Router: cutter diameter. Laser/plasma: kerf (the width of the cut).
  diameter: number;
  // V-bit included angle, degrees.
  vAngle: number;
  // Stock extends this far beyond the toolpath's own footprint, per side.
  margin: number;
  // 0 = automatic (router: deepest cut plus a little; laser/plasma: 3 mm).
  thickness: number;
  // Z of the top of the stock in work coordinates.
  topZ: number;
  // Grid resolution in mm; 0 = automatic (see autoCellSize). Coarsened when the
  // stock is too big for it to fit in maxCells.
  cell: number;
  // Most samples the grid may have. More cells keep detail on bigger stock at
  // the cost of memory and a slower first calculation.
  maxCells: number;
  // Laser only: the S value that burns all the way through. Lower power
  // engraves proportionally shallower. 0 = the highest S found in the file.
  fullPower: number;
};

export const DEFAULT_STOCK_SETTINGS: StockSettings = {
  process: "router",
  shape: "flat",
  diameter: 6,
  vAngle: 60,
  margin: 5,
  thickness: 0,
  topZ: 0,
  cell: 0.5,
  maxCells: 2_000_000,
  fullPower: 0,
};

export const MIN_MAX_CELLS = 250_000;
export const MAX_MAX_CELLS = 8_000_000;

// The grid size used when `cell` is 0: fine enough that the cutter's own width
// is a few samples across, so a kerf or a raster gap isn't lost. Laser and
// plasma: half the kerf (a 0.2 mm kerf gets 0.1 mm samples). Router: a tenth of
// the cutter diameter. Never finer than 0.02 mm or coarser than 2 mm.
export const autoCellSize = (settings: Pick<StockSettings, "process" | "diameter">) => {
  const divisor = settings.process === "router" ? 10 : 2;
  return Math.min(2, Math.max(0.02, settings.diameter / divisor));
};

// A toolpath flattened into typed arrays: cheap to post to a worker (transfer)
// and tight to loop over.
export type PackedToolpath = {
  // x0, y0, z0, x1, y1, z1 per segment.
  coords: Float32Array;
  // 1 for a rapid (never cuts).
  rapid: Uint8Array;
  // The S word in effect for the segment (laser power); 0 when none.
  power: Float32Array;
  inches: boolean;
};

type SegmentLike = {
  start: { x: number; y: number; z: number };
  end: { x: number; y: number; z: number };
  rapid: boolean;
  spindleSpeed?: number;
  inches?: boolean;
};

export const packToolpath = (segments: SegmentLike[]): PackedToolpath => {
  const coords = new Float32Array(segments.length * 6);
  const rapid = new Uint8Array(segments.length);
  const power = new Float32Array(segments.length);
  segments.forEach((segment, i) => {
    const o = i * 6;
    coords[o] = segment.start.x;
    coords[o + 1] = segment.start.y;
    coords[o + 2] = segment.start.z;
    coords[o + 3] = segment.end.x;
    coords[o + 4] = segment.end.y;
    coords[o + 5] = segment.end.z;
    rapid[i] = segment.rapid ? 1 : 0;
    power[i] = segment.spindleSpeed && segment.spindleSpeed > 0 ? segment.spindleSpeed : 0;
  });
  return { coords, rapid, power, inches: segments.length > 0 && segments[0].inches === true };
};

export type StockGrid = {
  nx: number;
  ny: number;
  // World position of sample (0, 0), and the spacing, in the file's units.
  ox: number;
  oy: number;
  cell: number;
  top: number;
  bottom: number;
  // True when the requested cell size was too fine and was coarsened.
  coarsened: boolean;
};

// Budget for the per-job restore points (see StockSimulator).
const MAX_SNAPSHOT_BYTES = 160 * 1024 * 1024;
const MAX_SNAPSHOTS = 40;
const MM_PER_INCH = 25.4;
const AUTO_EXTRA_DEPTH_MM = 3;
const AUTO_THROUGH_THICKNESS_MM = 3;

type ToolModel = {
  process: StockProcess;
  shape: StockShape;
  radius: number;
  tanHalf: number;
  hasPower: boolean;
  fullPower: number;
};

const toolModel = (packed: PackedToolpath, settings: StockSettings): ToolModel => {
  const units = packed.inches ? 1 / MM_PER_INCH : 1;
  let maxPower = 0;
  for (let i = 0; i < packed.power.length; i++) if (packed.power[i] > maxPower) maxPower = packed.power[i];
  const half = (Math.min(150, Math.max(10, settings.vAngle)) / 2) * (Math.PI / 180);
  return {
    process: settings.process,
    // Laser and plasma have no profile: the kerf is a straight-sided slot.
    shape: settings.process === "router" ? settings.shape : "flat",
    radius: Math.max(settings.diameter, 0.01) * units * 0.5,
    tanHalf: Math.tan(half),
    hasPower: maxPower > 0,
    fullPower: settings.fullPower > 0 ? settings.fullPower : maxPower > 0 ? maxPower : 1,
  };
};

const cuts = (tool: ToolModel, packed: PackedToolpath, i: number) => {
  if (packed.rapid[i]) return false;
  if (tool.process === "router") return true;
  // A laser/plasma file with no S words at all is treated as always on;
  // otherwise S0 is "off" and the move is just travel.
  return !tool.hasPower || packed.power[i] > 0;
};

// Works out the stock block: the toolpath's footprint plus the margin, its
// thickness, and a grid fine enough for the requested cell size without
// exceeding settings.maxCells. null when nothing in the toolpath actually cuts.
export const planStockGrid = (packed: PackedToolpath, settings: StockSettings): StockGrid | null => {
  const units = packed.inches ? 1 / MM_PER_INCH : 1;
  const tool = toolModel(packed, settings);
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  let minZ = Infinity;
  const count = packed.rapid.length;
  for (let i = 0; i < count; i++) {
    if (!cuts(tool, packed, i)) continue;
    const o = i * 6;
    minX = Math.min(minX, packed.coords[o], packed.coords[o + 3]);
    maxX = Math.max(maxX, packed.coords[o], packed.coords[o + 3]);
    minY = Math.min(minY, packed.coords[o + 1], packed.coords[o + 4]);
    maxY = Math.max(maxY, packed.coords[o + 1], packed.coords[o + 4]);
    minZ = Math.min(minZ, packed.coords[o + 2], packed.coords[o + 5]);
  }
  if (!Number.isFinite(minX)) return null;

  const pad = Math.max(settings.margin, 0) * units + tool.radius;
  const width = maxX - minX + 2 * pad;
  const height = maxY - minY + 2 * pad;
  const maxCells = Math.min(MAX_MAX_CELLS, Math.max(MIN_MAX_CELLS, settings.maxCells || DEFAULT_STOCK_SETTINGS.maxCells));
  let cell = Math.max((settings.cell > 0 ? settings.cell : autoCellSize(settings)) * units, 1e-4);
  const requested = cell;
  while ((Math.ceil(width / cell) + 1) * (Math.ceil(height / cell) + 1) > maxCells) cell *= 1.05;

  const top = settings.topZ * units;
  let thickness = settings.thickness * units;
  if (!(thickness > 0)) {
    thickness =
      settings.process === "router"
        ? Math.max(top - minZ, 0) + AUTO_EXTRA_DEPTH_MM * units
        : AUTO_THROUGH_THICKNESS_MM * units;
  }
  return {
    nx: Math.ceil(width / cell) + 1,
    ny: Math.ceil(height / cell) + 1,
    ox: minX - pad,
    oy: minY - pad,
    cell,
    top,
    bottom: top - thickness,
    coarsened: cell > requested * 1.0001,
  };
};

// Holds the heightfield for one job and moves it to "after N segments". Moving
// forward stamps just the new segments, so playback costs only what was added;
// moving backward restores the nearest earlier snapshot and re-stamps from there.
export class StockSimulator {
  readonly grid: StockGrid;
  readonly segmentCount: number;
  private readonly packed: PackedToolpath;
  private readonly tool: ToolModel;
  private readonly heights: Float32Array;
  private index = 0;
  private readonly step: number;
  // snapshots[k] = the heights after k * step segments (k = 0 is the untouched block).
  private readonly snapshots: Float32Array[] = [];
  // The in-progress segment that was stamped part-way on top of `index`, if any.
  // It's always a subset of what the full segment will stamp, so moving forward
  // needs no cleanup; only moving back (or less far into it) has to restore.
  private partialIndex = -1;
  private partialFraction = 0;

  constructor(packed: PackedToolpath, settings: StockSettings, grid: StockGrid) {
    this.packed = packed;
    this.grid = grid;
    const tool = toolModel(packed, settings);
    // A cut narrower than the grid can fall between samples and vanish, depending
    // on how it happens to line up. Half a cell's diagonal guarantees any line
    // crosses at least one sample, so thin laser/plasma kerfs always show (drawn
    // up to ~1.4 cells wide at worst).
    tool.radius = Math.max(tool.radius, grid.cell * 0.71);
    this.tool = tool;
    this.segmentCount = packed.rapid.length;
    this.heights = new Float32Array(grid.nx * grid.ny);
    this.heights.fill(grid.top);
    const bytesPerSnapshot = this.heights.byteLength;
    const affordable = Math.max(1, Math.floor(MAX_SNAPSHOT_BYTES / bytesPerSnapshot));
    const snapshotCount = Math.min(MAX_SNAPSHOTS, affordable);
    this.step = Math.max(1, Math.ceil(this.segmentCount / snapshotCount));
    this.snapshots.push(this.heights.slice());
  }

  // How many segments have been applied.
  getIndex() {
    return this.index;
  }

  // The live height samples, nx * ny, row-major (row = Y). Don't keep a
  // reference across calls: it's overwritten as the simulation moves.
  getHeights() {
    return this.heights;
  }

  // Moves the stock to the state after `target` whole segments, plus the first
  // `fraction` (0..1) of the segment that comes next - the one being cut now.
  seek(target: number, fraction = 0) {
    const to = Math.max(0, Math.min(this.segmentCount, Math.floor(target)));
    const part = to < this.segmentCount ? Math.max(0, Math.min(1, fraction)) : 0;
    const staleBack =
      this.partialIndex >= 0 && (to < this.partialIndex || (to === this.partialIndex && part < this.partialFraction));
    if (to < this.index || staleBack) {
      const known = this.snapshots.length - 1;
      const k = Math.min(Math.floor(to / this.step), known);
      this.heights.set(this.snapshots[k]);
      this.index = k * this.step;
      this.partialIndex = -1;
    }
    while (this.index < to) {
      this.stampSegment(this.index);
      this.index++;
      if (this.index % this.step === 0 && this.snapshots.length === this.index / this.step) {
        this.snapshots.push(this.heights.slice());
      }
    }
    if (part > 0) {
      this.stampSegment(to, part);
      this.partialIndex = to;
      this.partialFraction = part;
    } else {
      this.partialIndex = -1;
    }
  }

  private stampSegment(i: number, fraction = 1) {
    const { packed, tool, grid, heights } = this;
    if (!cuts(tool, packed, i)) return;
    const o = i * 6;
    const x0 = packed.coords[o];
    const y0 = packed.coords[o + 1];
    const z0 = packed.coords[o + 2];
    const x1 = x0 + (packed.coords[o + 3] - x0) * fraction;
    const y1 = y0 + (packed.coords[o + 4] - y0) * fraction;
    const z1 = z0 + (packed.coords[o + 5] - z0) * fraction;
    const { nx, ny, ox, oy, cell, top, bottom } = grid;
    const radius = tool.radius;

    // What the cutter does to the stock, as a function of where along the move
    // it is: a fixed level (laser/plasma) or the tip height (router).
    const router = tool.process === "router";
    let fixedLevel = bottom;
    if (tool.process === "laser") {
      const fraction = tool.hasPower ? Math.min(1, packed.power[i] / tool.fullPower) : 1;
      fixedLevel = fraction >= 1 ? bottom : top - fraction * (top - bottom);
    }
    if (router && Math.min(z0, z1) >= top) return; // moving in the air

    const i0 = Math.max(0, Math.floor((Math.min(x0, x1) - radius - ox) / cell));
    const i1 = Math.min(nx - 1, Math.ceil((Math.max(x0, x1) + radius - ox) / cell));
    const j0 = Math.max(0, Math.floor((Math.min(y0, y1) - radius - oy) / cell));
    const j1 = Math.min(ny - 1, Math.ceil((Math.max(y0, y1) + radius - oy) / cell));
    const dx = x1 - x0;
    const dy = y1 - y0;
    const len2 = dx * dx + dy * dy;
    const plunge = len2 < 1e-12;
    const r2 = radius * radius;
    const zLow = Math.min(z0, z1);
    const shape = tool.shape;
    const tanHalf = tool.tanHalf;

    for (let j = j0; j <= j1; j++) {
      const py = oy + j * cell;
      const row = j * nx;
      for (let ii = i0; ii <= i1; ii++) {
        const px = ox + ii * cell;
        let t = 0;
        if (!plunge) {
          t = ((px - x0) * dx + (py - y0) * dy) / len2;
          t = t < 0 ? 0 : t > 1 ? 1 : t;
        }
        const ex = px - (x0 + t * dx);
        const ey = py - (y0 + t * dy);
        const d2 = ex * ex + ey * ey;
        if (d2 > r2) continue;
        let level = fixedLevel;
        if (router) {
          const tip = plunge ? zLow : z0 + t * (z1 - z0);
          if (shape === "flat") level = tip;
          else if (shape === "ball") level = tip + radius - Math.sqrt(r2 - d2);
          else level = tip + Math.sqrt(d2) / tanHalf;
          if (level < bottom) level = bottom;
        }
        const k = row + ii;
        if (level < heights[k]) heights[k] = level;
      }
    }
  }
}
