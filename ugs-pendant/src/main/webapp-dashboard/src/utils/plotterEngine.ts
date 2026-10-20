// The Stock view's plotter mode: ink on a sheet of paper instead of material cut out of a block.
// Pure logic with no DOM or three.js, so it is unit-tested in node (tests/plotterEngine.test.cjs).
// plotterModel.ts draws what this plans.
//
// A plotter has no depth to simulate. A pen moves with the pen down (at or below the paper surface) or
// up, and where it is down it leaves a line of the pen's color and width. How far below the surface it
// goes is only pressure, so it is ignored here.

import type { PackedToolpath } from "./stockSimEngine";

export type PaperSheet = "fit" | "a4" | "a3" | "letter" | "custom";

export type PlotterOptions = {
  paperColor: string;
  // "fit" sizes the paper to the drawing plus the margin; the others are a real sheet.
  sheet: PaperSheet;
  // A real sheet: turn it on its side (a portrait A4 becomes 297 x 210).
  landscape: boolean;
  // "custom" sheet size, mm.
  width: number;
  height: number;
  // A real sheet: where its lower-left corner sits in work coordinates, mm.
  x: number;
  y: number;
};

export const DEFAULT_PLOTTER_OPTIONS: PlotterOptions = {
  paperColor: "#ffffff",
  sheet: "fit",
  landscape: false,
  width: 210,
  height: 297,
  x: 0,
  y: 0,
};

// Portrait sizes, mm.
export const SHEET_SIZES: Record<"a4" | "a3" | "letter", [number, number]> = {
  a4: [210, 297],
  a3: [297, 420],
  letter: [215.9, 279.4],
};

export const SHEET_LABELS: Record<PaperSheet, string> = {
  fit: "Fit the drawing",
  a4: "A4",
  a3: "A3",
  letter: "Letter",
  custom: "Custom size",
};

// The pen colors and widths, by tool number, and what a segment with no pen gets.
export type PenStyle = { color: string; width: number };

export const NO_PEN_COLOR = "#1f1f1f";

// The width and height of a real sheet in mm, or null for "fit the drawing".
export const sheetDimensions = (options: PlotterOptions): { width: number; height: number } | null => {
  if (options.sheet === "fit") return null;
  const [width, height] = options.sheet === "custom" ? [options.width, options.height] : SHEET_SIZES[options.sheet];
  return options.landscape ? { width: height, height: width } : { width, height };
};

// Whether a segment leaves ink: a feed move with the pen at or below the paper surface at both ends,
// that actually goes somewhere (a plunge in place is the pen touching down, not a mark). All lengths
// are mm here, so `unit` converts the file's own units (1 for mm files, 25.4 for inch files).
export const isInk = (packed: PackedToolpath, index: number, surfaceZ: number, unit: number): boolean => {
  if (packed.rapid[index] === 1) return false;
  const o = index * 6;
  const c = packed.coords;
  const limit = surfaceZ / unit + 1e-6;
  if (c[o + 2] > limit || c[o + 5] > limit) return false;
  return c[o] !== c[o + 3] || c[o + 1] !== c[o + 4];
};

export type InkScan = {
  // One flag per segment: does it leave ink?
  ink: Uint8Array;
  count: number;
  // The extent of all the ink, mm; null when there is none.
  bounds: { minX: number; minY: number; maxX: number; maxY: number } | null;
};

export const scanInk = (packed: PackedToolpath, surfaceZ: number): InkScan => {
  const unit = packed.inches ? 25.4 : 1;
  const total = packed.rapid.length;
  const ink = new Uint8Array(total);
  let count = 0;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (let i = 0; i < total; i++) {
    if (!isInk(packed, i, surfaceZ, unit)) continue;
    ink[i] = 1;
    count++;
    const o = i * 6;
    for (const k of [0, 3]) {
      minX = Math.min(minX, packed.coords[o + k] * unit);
      maxX = Math.max(maxX, packed.coords[o + k] * unit);
      minY = Math.min(minY, packed.coords[o + k + 1] * unit);
      maxY = Math.max(maxY, packed.coords[o + k + 1] * unit);
    }
  }
  return { ink, count, bounds: count > 0 ? { minX, minY, maxX, maxY } : null };
};

export type PaperPlan = {
  // The sheet in work coordinates, mm.
  x: number;
  y: number;
  width: number;
  height: number;
  // The picture it is drawn into.
  pxPerMm: number;
  cols: number;
  rows: number;
  // The picture had to be coarser than asked for to stay inside the pixel budget.
  coarsened: boolean;
};

// The biggest side of the picture; GPUs reject textures much larger than this.
const MAX_SIDE = 8192;
const MIN_SIDE_MM = 1;

// Where the paper is and how finely to draw it. `cellMm` is the size of one picture pixel; the
// picture is made coarser when it would pass `maxPixels` (or the texture size limit).
export const planPaper = (
  bounds: NonNullable<InkScan["bounds"]>,
  margin: number,
  options: PlotterOptions,
  cellMm: number,
  maxPixels: number
): PaperPlan => {
  const sheet = sheetDimensions(options);
  const x = sheet ? options.x : bounds.minX - margin;
  const y = sheet ? options.y : bounds.minY - margin;
  const width = Math.max(MIN_SIDE_MM, sheet ? sheet.width : bounds.maxX - bounds.minX + 2 * margin);
  const height = Math.max(MIN_SIDE_MM, sheet ? sheet.height : bounds.maxY - bounds.minY + 2 * margin);

  const wanted = 1 / Math.max(cellMm, 1e-3);
  const budget = Math.sqrt(Math.max(1, maxPixels) / (width * height));
  const side = MAX_SIDE / Math.max(width, height);
  const pxPerMm = Math.min(wanted, budget, side);
  return {
    x,
    y,
    width,
    height,
    pxPerMm,
    cols: Math.max(1, Math.ceil(width * pxPerMm)),
    rows: Math.max(1, Math.ceil(height * pxPerMm)),
    coarsened: pxPerMm < wanted * 0.999,
  };
};

// One picture pixel for the thinnest pen in play: half its width, kept between 0.05 and 1 mm so
// lines stay a couple of pixels wide without a sheet becoming a gigapixel picture.
export const autoPlotterCell = (penWidths: number[], fallbackWidth: number): number => {
  const thinnest = penWidths.length > 0 ? Math.min(...penWidths) : fallbackWidth;
  return Math.min(1, Math.max(0.05, thinnest / 2));
};

export const isPaperColor = (value: unknown): value is string =>
  typeof value === "string" && /^#[0-9a-f]{6}$/i.test(value);

const finite = (value: unknown, fallback: number, min: number, max: number) =>
  typeof value === "number" && Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : fallback;

// Anything stored is put back into a sensible range, like the other stock settings.
export const sanitizePlotterOptions = (raw: Partial<PlotterOptions> | undefined): PlotterOptions => ({
  paperColor: isPaperColor(raw?.paperColor) ? raw.paperColor.toLowerCase() : DEFAULT_PLOTTER_OPTIONS.paperColor,
  sheet: (["fit", "a4", "a3", "letter", "custom"] as string[]).includes(raw?.sheet as string)
    ? (raw?.sheet as PaperSheet)
    : DEFAULT_PLOTTER_OPTIONS.sheet,
  landscape: raw?.landscape === true,
  width: finite(raw?.width, DEFAULT_PLOTTER_OPTIONS.width, 1, 5000),
  height: finite(raw?.height, DEFAULT_PLOTTER_OPTIONS.height, 1, 5000),
  x: finite(raw?.x, DEFAULT_PLOTTER_OPTIONS.x, -10000, 10000),
  y: finite(raw?.y, DEFAULT_PLOTTER_OPTIONS.y, -10000, 10000),
});
