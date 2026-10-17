// The Stock view's tool table: which tool is cutting at each point of the file,
// what that tool looks like, and the colors used to tell tools apart. Pure
// logic with no DOM, so it is unit-tested in node (tests/toolTable.test.cjs).
//
// Tools are found in the G-code itself (T words, M6) and described by guessing
// from comments next to the change ("( T0 : 3.175 )", "(T2 1/8 ball nose)").
// Anything the guess gets wrong, or the file doesn't say, is fixed in the
// table; those edits are saved per tool number.

import type { CutterSpec, StockShape } from "./stockSimEngine";

export type { CutterSpec };

export type ToolChange = { line: number; tool: number };

// What the comments near a tool change say about it. Anything unsaid is absent.
export type ToolHint = {
  tool: number;
  shape?: StockShape;
  diameter?: number;
  vAngle?: number;
};

export type ToolScan = {
  // In file order: the line (1-based) where each tool becomes active.
  changes: ToolChange[];
  hints: Record<number, ToolHint>;
};

// What is stored for one tool number. `cutter` and `color` are the user's own
// edits; `removed` means "ignore this tool: use the default cutter for it".
export type SavedTool = {
  cutter?: CutterSpec;
  color?: string;
  removed?: boolean;
};
export type SavedTools = Record<number, SavedTool>;

export const EMPTY_SCAN: ToolScan = { changes: [], hints: {} };

// A segment's ToolpathSegment.lineNumber is the file's 1-based line, comments
// and blank lines included: GcodeParserUtils.processAndExportText numbers every
// line from 1 and the processed file carries that number through to the
// toolpath (the same convention the editor-cursor highlight in Visualizer3D
// relies on). Note ugs-pendant/mock-backend numbers differently (0-based, no
// comments or blanks), so tool changes land on the wrong segments there; the
// online demo and the real backend agree. This is the one place to correct it.
export const SEGMENT_LINE_OFFSET = 0;

const MM_PER_INCH = 25.4;
// How many lines before a tool change a free-form description still counts as
// being about that tool.
const DESCRIPTION_REACH = 3;

const stripComments = (line: string) => {
  const comments: string[] = [];
  let code = line.replace(/\(([^)]*)\)?/g, (_match, text: string) => {
    comments.push(text);
    return " ";
  });
  const semicolon = code.indexOf(";");
  if (semicolon >= 0) {
    comments.push(code.slice(semicolon + 1));
    code = code.slice(0, semicolon);
  }
  return { code: code.toUpperCase(), comments };
};

const parseNumber = (text: string): number | null => {
  const fraction = /^(\d+)\s*\/\s*(\d+)$/.exec(text.trim());
  if (fraction) {
    const denominator = Number(fraction[2]);
    return denominator > 0 ? Number(fraction[1]) / denominator : null;
  }
  const value = Number(text);
  return Number.isFinite(value) ? value : null;
};

const toMm = (value: number, unit: string | undefined, fileInches: boolean) => {
  const u = unit?.toLowerCase();
  if (u === "mm") return value;
  if (u === "in" || u === "inch" || u === "inches" || u === '"') return value * MM_PER_INCH;
  return fileInches ? value * MM_PER_INCH : value;
};

const SHAPE_WORDS: [RegExp, StockShape][] = [
  [/bull\s*-?\s*nose|corner\s*radius/i, "bullnose"],
  [/taper/i, "taperball"],
  [/ball/i, "ball"],
  [/v\s*-?\s*bit|\bvee\b|v\s*-?\s*groove|engrav|chamfer/i, "v"],
  [/flat|square|end\s*-?\s*mill|straight|up\s*-?\s*cut|down\s*-?\s*cut|compression/i, "flat"],
];

// Guesses a cutter from a free-form description. Returns only what it found.
export const describeCutter = (text: string, fileInches: boolean): Omit<ToolHint, "tool"> => {
  const hint: Omit<ToolHint, "tool"> = {};
  for (const [pattern, shape] of SHAPE_WORDS) {
    if (pattern.test(text)) {
      hint.shape = shape;
      break;
    }
  }
  const angle = /(\d+(?:\.\d+)?)\s*(?:°|deg(?:ree)?s?\b)/i.exec(text);
  if (angle) hint.vAngle = Number(angle[1]);

  // "6 mm", '1/4"', "1/8 in", or a diameter label ("dia 3.175", "Ø6"). A length
  // that is a depth or a cutter length ("12 mm long") is not the diameter.
  const withUnit = /(\d+\s*\/\s*\d+|\d+(?:\.\d+)?)\s*(mm|inches|inch|in\b|")(?!\s*(?:deep|long|length|lg|loc|oal))/gi;
  let match: RegExpExecArray | null;
  let diameter: number | null = null;
  while ((match = withUnit.exec(text)) !== null) {
    const value = parseNumber(match[1]);
    if (value !== null && value > 0 && !/^\s*(?:x|\*)/i.test(text.slice(withUnit.lastIndex, withUnit.lastIndex + 3))) {
      diameter = toMm(value, match[2], fileInches);
      break;
    }
  }
  if (diameter === null) {
    const labeled = /(?:[Ø⌀]|\bdia(?:meter)?\.?)\s*[:=]?\s*(\d+\s*\/\s*\d+|\d+(?:\.\d+)?)/i.exec(text);
    const value = labeled ? parseNumber(labeled[1]) : null;
    if (value !== null && value > 0) diameter = toMm(value, undefined, fileInches);
  }
  if (diameter !== null) hint.diameter = diameter;
  return hint;
};

const hasHint = (hint: Omit<ToolHint, "tool">) =>
  hint.shape !== undefined || hint.diameter !== undefined || hint.vAngle !== undefined;

// Reads the tool changes and what the comments say about each tool.
//
// A change is a line with M6 (the tool named by that line's T word, or by the
// last T word seen) or - when the file never uses M6 - a bare T word. The
// header form "( T0 : 3.175 )" names a diameter in the file's own units.
export const scanTools = (text: string): ToolScan => {
  const lines = text.split(/\r?\n/);
  const parsed = lines.map(stripComments);
  const usesM6 = parsed.some((p) => /\bM0?6\b/.test(p.code));

  const changes: ToolChange[] = [];
  const hints: Record<number, ToolHint> = {};
  let inches = false;
  let pending: number | null = null;
  let current: number | null = null;
  const descriptions: { line: number; hint: Omit<ToolHint, "tool"> }[] = [];

  const merge = (tool: number, hint: Omit<ToolHint, "tool">) => {
    const known = hints[tool] ?? { tool };
    hints[tool] = { ...hint, ...known, tool };
  };

  parsed.forEach(({ code, comments }, index) => {
    const line = index + 1;
    if (/\bG20\b/.test(code)) inches = true;
    else if (/\bG21\b/.test(code)) inches = false;

    for (const comment of comments) {
      const header = /^\s*T(\d+)\s*[:=]\s*(\d+\s*\/\s*\d+|\d*\.?\d+)\s*$/i.exec(comment);
      if (header) {
        const value = parseNumber(header[2]);
        if (value !== null && value > 0) merge(Number(header[1]), { diameter: toMm(value, undefined, inches) });
        continue;
      }
      const described = describeCutter(comment, inches);
      if (!hasHint(described)) continue;
      const named = /\bT(?:OOL)?\s*#?(\d+)\b/i.exec(comment);
      if (named) merge(Number(named[1]), described);
      else descriptions.push({ line, hint: described });
    }

    const word = /\bT0*(\d+)\b/.exec(code);
    const tWord = word ? Number(word[1]) : null;
    let changed: number | null = null;
    if (usesM6) {
      if (tWord !== null) pending = tWord;
      if (/\bM0?6\b/.test(code)) changed = tWord ?? pending;
    } else if (tWord !== null) {
      changed = tWord;
    }
    if (changed !== null && changed !== current) {
      current = changed;
      changes.push({ line, tool: changed });
      for (const description of descriptions) {
        if (line - description.line <= DESCRIPTION_REACH) merge(changed, description.hint);
      }
      descriptions.length = 0;
    } else if (changed !== null) {
      // The same tool again: nothing changes, but the descriptions are used up.
      descriptions.length = 0;
    }
  });
  return { changes, hints };
};

// The tool in effect at each segment (by tool number), -1 where none has been
// chosen yet. `changes` must be in file order (as scanTools returns them).
export const segmentToolNumbers = (segments: { lineNumber: number }[], changes: ToolChange[]): Int32Array => {
  const result = new Int32Array(segments.length).fill(-1);
  if (changes.length === 0) return result;
  for (let i = 0; i < segments.length; i++) {
    const line = segments[i].lineNumber + SEGMENT_LINE_OFFSET;
    let lo = 0;
    let hi = changes.length - 1;
    let found = -1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (changes[mid].line <= line) {
        found = mid;
        lo = mid + 1;
      } else {
        hi = mid - 1;
      }
    }
    if (found >= 0) result[i] = changes[found].tool;
  }
  return result;
};

// Distinct tools with at least one cutting segment, in order of first use.
export const toolsUsed = (segmentTools: Int32Array, rapid: (index: number) => boolean): number[] => {
  const seen = new Set<number>();
  const order: number[] = [];
  for (let i = 0; i < segmentTools.length; i++) {
    const tool = segmentTools[i];
    if (tool < 0 || seen.has(tool) || rapid(i)) continue;
    seen.add(tool);
    order.push(tool);
  }
  return order;
};

// Eight colors that stay apart from each other and from the wood tones of the
// stock; tool numbers cycle through them.
export const TOOL_PALETTE = ["#3b82f6", "#ef4444", "#22c55e", "#f59e0b", "#a855f7", "#06b6d4", "#ec4899", "#84cc16"];

export const defaultToolColor = (tool: number) => TOOL_PALETTE[Math.abs(tool) % TOOL_PALETTE.length];

export const isHexColor = (value: unknown): value is string =>
  typeof value === "string" && /^#[0-9a-f]{6}$/i.test(value);

// What the file says about a tool laid over the default cutter: the fields the
// comments didn't mention keep the default's values.
// Just the cutter's own fields, so a full settings object can be passed in.
export const pickCutter = (from: CutterSpec): CutterSpec => ({
  shape: from.shape,
  diameter: from.diameter,
  vAngle: from.vAngle,
  cornerRadius: from.cornerRadius,
  tipDiameter: from.tipDiameter,
});

export const cutterFromHint = (base: CutterSpec, hint: ToolHint | undefined): CutterSpec => {
  if (!hint) return pickCutter(base);
  const shape = hint.shape ?? base.shape;
  const diameter = hint.diameter ?? base.diameter;
  return {
    shape,
    diameter,
    vAngle: hint.vAngle ?? base.vAngle,
    cornerRadius: Math.min(base.cornerRadius, diameter / 2),
    tipDiameter: shape === "taperball" && base.tipDiameter <= 0 ? Math.min(1, diameter) : base.tipDiameter,
  };
};

export type ToolRow = {
  tool: number;
  // Named by a tool change in the loaded file (rather than only saved earlier).
  inFile: boolean;
  cutter: CutterSpec;
  color: string;
  // The user changed the cutter or color, so Reset has something to undo.
  edited: boolean;
  // Deleted: segments with this tool use the default cutter.
  removed: boolean;
};

// One row per tool: the ones in the loaded file plus any saved earlier, in
// number order. A removed tool still has a row so it can be restored.
export const buildToolRows = (scan: ToolScan, saved: SavedTools, base: CutterSpec): ToolRow[] => {
  const numbers = new Set<number>(scan.changes.map((change) => change.tool));
  const inFile = new Set(numbers);
  for (const key of Object.keys(saved)) numbers.add(Number(key));
  return [...numbers]
    .sort((a, b) => a - b)
    .map((tool) => {
      const entry = saved[tool];
      return {
        tool,
        inFile: inFile.has(tool),
        cutter: entry?.cutter ?? cutterFromHint(base, scan.hints[tool]),
        color: entry?.color ?? defaultToolColor(tool),
        edited: entry !== undefined && (entry.cutter !== undefined || entry.color !== undefined),
        removed: entry?.removed === true,
      };
    });
};

// The cutters the simulator should use, by tool number (removed tools left out
// so they fall back to the default cutter).
export const cutterTable = (rows: ToolRow[]): Record<number, CutterSpec> => {
  const table: Record<number, CutterSpec> = {};
  for (const row of rows) if (!row.removed && row.inFile) table[row.tool] = row.cutter;
  return table;
};

export const toolColors = (rows: ToolRow[]): Record<number, string> => {
  const colors: Record<number, string> = {};
  for (const row of rows) if (!row.removed) colors[row.tool] = row.color;
  return colors;
};

// --- Edits to the saved table (each returns a new object) ---

export const setToolCutter = (saved: SavedTools, tool: number, cutter: CutterSpec): SavedTools => {
  const { removed: _removed, ...rest } = saved[tool] ?? {};
  return { ...saved, [tool]: { ...rest, cutter } };
};

export const setToolColor = (saved: SavedTools, tool: number, color: string): SavedTools => {
  const { removed: _removed, ...rest } = saved[tool] ?? {};
  return { ...saved, [tool]: { ...rest, color } };
};

// Reset: forget everything saved for the tool, so it goes back to what the
// file says (or to the default cutter) - and a removed tool comes back.
export const resetTool = (saved: SavedTools, tool: number): SavedTools => {
  const next = { ...saved };
  delete next[tool];
  return next;
};

// Delete: a tool the file names stays listed as removed (so it stays gone and
// can be restored); one that is only saved is simply forgotten.
export const deleteTool = (saved: SavedTools, tool: number, inFile: boolean): SavedTools => {
  if (!inFile) return resetTool(saved, tool);
  const { cutter: _cutter, color: _color, ...rest } = saved[tool] ?? {};
  return { ...saved, [tool]: { ...rest, removed: true } };
};

export const restoreTool = (saved: SavedTools, tool: number): SavedTools => {
  const entry = saved[tool];
  if (!entry) return saved;
  const { removed: _removed, ...rest } = entry;
  const next = { ...saved };
  if (rest.cutter === undefined && rest.color === undefined) delete next[tool];
  else next[tool] = rest;
  return next;
};

// Adds a tool by number, with the default cutter, so a tool the loaded file
// doesn't mention can be set up ahead of time. Nothing changes if it exists.
export const addTool = (saved: SavedTools, tool: number, base: CutterSpec): SavedTools =>
  saved[tool] ? saved : { ...saved, [tool]: { cutter: pickCutter(base) } };

export const MAX_TOOL_NUMBER = 99999;

const SHAPE_NAMES: Record<StockShape, string> = {
  flat: "Flat",
  ball: "Ball nose",
  bullnose: "Bull nose",
  v: "V-bit",
  taperball: "Taper ball",
};

const trimmed = (value: number) => String(Number(value.toFixed(3)));

// "Ball nose 3.175 mm", "V-bit 60°, 6 mm" - the table's one-line description.
export const cutterSummary = (cutter: CutterSpec): string => {
  const size = `${trimmed(cutter.diameter)} mm`;
  switch (cutter.shape) {
    case "v":
      return cutter.tipDiameter > 0
        ? `Chamfer ${trimmed(cutter.vAngle)}°, ${size}, ${trimmed(cutter.tipDiameter)} mm flat`
        : `V-bit ${trimmed(cutter.vAngle)}°, ${size}`;
    case "taperball":
      return `Taper ball ${trimmed(cutter.vAngle)}°, ${size}, ${trimmed(cutter.tipDiameter)} mm tip`;
    case "bullnose":
      return `Bull nose ${size}, ${trimmed(cutter.cornerRadius)} mm corner`;
    default:
      return `${SHAPE_NAMES[cutter.shape]} ${size}`;
  }
};
