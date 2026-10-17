import {
  CutterSpec,
  DEFAULT_STOCK_SETTINGS,
  MAX_MAX_CELLS,
  MIN_MAX_CELLS,
  StockProcess,
  StockSettings,
} from "./stockSimEngine";
import { isHexColor, MAX_TOOL_NUMBER, SavedTool, SavedTools } from "./toolTable";

// Each process keeps its own cutter/stock numbers (a 6 mm endmill and a 0.2 mm
// laser kerf have nothing in common), and the last-used process is remembered.
export type StockProfiles = {
  process: StockProcess;
  // Draw the toolpath lines over the stock (off by default: dense paths hide the cut).
  showPath: boolean;
  // Router: tint what each tool cut in that tool's color when a file uses
  // two or more tools.
  colorByTool: boolean;
  // Router: warn when a rapid (G0) move runs the cutter through uncut material.
  warnRapids: boolean;
  // Router: what the user changed in the tool table, by tool number.
  tools: SavedTools;
  settings: Record<StockProcess, StockSettings>;
};

export const STOCK_PROFILES_STORAGE_KEY = "ugs.dashboard.stockSimulation";

export const DEFAULT_STOCK_PROFILES: StockProfiles = {
  process: "router",
  showPath: false,
  colorByTool: true,
  warnRapids: true,
  tools: {},
  settings: {
    router: { ...DEFAULT_STOCK_SETTINGS, process: "router", shape: "flat", diameter: 6, cell: 0.5 },
    // cell 0 = automatic (kerf / 2), so a different kerf gets a matching grid.
    laser: { ...DEFAULT_STOCK_SETTINGS, process: "laser", shape: "flat", diameter: 0.2, cell: 0, thickness: 3 },
    plasma: { ...DEFAULT_STOCK_SETTINGS, process: "plasma", shape: "flat", diameter: 1.5, cell: 0, thickness: 3 },
  },
};

const PROCESSES: StockProcess[] = ["router", "laser", "plasma"];
const SHAPES = ["flat", "ball", "bullnose", "v", "taperball"];

const finite = (value: unknown, fallback: number, min: number, max: number) =>
  typeof value === "number" && Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : fallback;

// Anything stored is clamped back into a sensible range, so a hand-edited or
// stale entry can't hand the simulator a zero-size cutter or a million-cell grid.
export const sanitizeStockSettings = (raw: Partial<StockSettings> | undefined, base: StockSettings): StockSettings => ({
  process: base.process,
  shape: SHAPES.includes(raw?.shape as string) ? (raw?.shape as StockSettings["shape"]) : base.shape,
  diameter: finite(raw?.diameter, base.diameter, 0.01, 200),
  vAngle: finite(raw?.vAngle, base.vAngle, 10, 150),
  cornerRadius: finite(raw?.cornerRadius, base.cornerRadius, 0, 100),
  tipDiameter: finite(raw?.tipDiameter, base.tipDiameter, 0, 200),
  margin: finite(raw?.margin, base.margin, 0, 500),
  thickness: finite(raw?.thickness, base.thickness, 0, 1000),
  topZ: finite(raw?.topZ, base.topZ, -1000, 1000),
  cell: finite(raw?.cell, base.cell, 0, 20),
  maxCells: finite(raw?.maxCells, base.maxCells, MIN_MAX_CELLS, MAX_MAX_CELLS),
  fullPower: finite(raw?.fullPower, base.fullPower, 0, 1_000_000),
});

export const sanitizeCutter = (raw: Partial<CutterSpec> | undefined, base: CutterSpec): CutterSpec => ({
  shape: SHAPES.includes(raw?.shape as string) ? (raw?.shape as CutterSpec["shape"]) : base.shape,
  diameter: finite(raw?.diameter, base.diameter, 0.01, 200),
  vAngle: finite(raw?.vAngle, base.vAngle, 10, 150),
  cornerRadius: finite(raw?.cornerRadius, base.cornerRadius, 0, 100),
  tipDiameter: finite(raw?.tipDiameter, base.tipDiameter, 0, 200),
});

// A saved table can be hand-edited or from an older version: keep only
// well-formed entries for sensible tool numbers, with every value clamped.
export const sanitizeSavedTools = (raw: unknown, base: CutterSpec): SavedTools => {
  const result: SavedTools = {};
  if (!raw || typeof raw !== "object") return result;
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    const tool = Number(key);
    if (!Number.isInteger(tool) || tool < 0 || tool > MAX_TOOL_NUMBER || !value || typeof value !== "object") continue;
    const entry = value as Partial<SavedTool>;
    const clean: SavedTool = {};
    if (entry.cutter && typeof entry.cutter === "object") clean.cutter = sanitizeCutter(entry.cutter, base);
    if (isHexColor(entry.color)) clean.color = entry.color.toLowerCase();
    if (entry.removed === true) clean.removed = true;
    if (clean.cutter || clean.color || clean.removed) result[tool] = clean;
  }
  return result;
};

export const readStockProfiles = (): StockProfiles => {
  try {
    const stored = window.localStorage.getItem(STOCK_PROFILES_STORAGE_KEY);
    if (!stored) return DEFAULT_STOCK_PROFILES;
    const parsed = JSON.parse(stored) as Partial<StockProfiles>;
    const settings = { ...DEFAULT_STOCK_PROFILES.settings };
    for (const process of PROCESSES) {
      settings[process] = sanitizeStockSettings(parsed.settings?.[process], DEFAULT_STOCK_PROFILES.settings[process]);
    }
    // Laser and plasma used to default to fixed cell sizes (0.2 / 0.5 mm); those
    // untouched defaults become "automatic" so they follow the kerf.
    if (parsed.settings?.laser?.cell === 0.2) settings.laser = { ...settings.laser, cell: 0 };
    if (parsed.settings?.plasma?.cell === 0.5) settings.plasma = { ...settings.plasma, cell: 0 };
    return {
      process: PROCESSES.includes(parsed.process as StockProcess) ? (parsed.process as StockProcess) : "router",
      showPath: parsed.showPath === true,
      colorByTool: parsed.colorByTool !== false,
      warnRapids: parsed.warnRapids !== false,
      tools: sanitizeSavedTools(parsed.tools, settings.router),
      settings,
    };
  } catch {
    return DEFAULT_STOCK_PROFILES;
  }
};

export const writeStockProfiles = (profiles: StockProfiles) => {
  try {
    window.localStorage.setItem(STOCK_PROFILES_STORAGE_KEY, JSON.stringify(profiles));
  } catch {
    // Not persisting is fine - it just starts from the defaults next time.
  }
};
