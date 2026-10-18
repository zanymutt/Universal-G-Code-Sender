// The preset values offered by the Jog pad's step-size and feed-rate selectors.
// Shared so the keyboard "step up / step down" actions walk the same ladder the
// on-screen buttons show.
//
// These are the defaults; the Settings page lets each row be customized (see
// jogPresetsSlice) and the pad and keyboard shortcuts use the customized rows.
export const STEP_SIZE_OPTIONS = [0.01, 0.1, 1, 10, 100, 1000];
export const FEED_RATE_OPTIONS = [10, 100, 500, 1000, 2000, 5000];

export type JogPresetKind = "xy" | "z" | "feed";
export type JogPresets = Record<JogPresetKind, number[]>;

export const JOG_PRESET_SLOTS = 6;

export const DEFAULT_JOG_PRESETS: JogPresets = {
  xy: STEP_SIZE_OPTIONS,
  z: STEP_SIZE_OPTIONS,
  feed: FEED_RATE_OPTIONS,
};

// A preset is a positive, finite number.
export const isValidPreset = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value) && value > 0;

// Turns whatever was saved (or nothing) into a full set of rows: a bad or
// missing slot falls back to that slot's default.
export const normalizeJogPresets = (raw: unknown): JogPresets => {
  const source = (typeof raw === "object" && raw !== null ? raw : {}) as Partial<Record<JogPresetKind, unknown>>;
  const row = (kind: JogPresetKind): number[] => {
    const saved = Array.isArray(source[kind]) ? (source[kind] as unknown[]) : [];
    return DEFAULT_JOG_PRESETS[kind].map((fallback, index) => (isValidPreset(saved[index]) ? saved[index] : fallback));
  };
  return { xy: row("xy"), z: row("z"), feed: row("feed") };
};

// The buttons and the step up / down ladder: ascending, duplicates dropped.
export const sortedPresets = (options: readonly number[]): number[] =>
  [...new Set(options)].sort((a, b) => a - b);

// The next preset above (dir 1) or below (dir -1) `value`. A value that isn't a
// preset (e.g. one set from the desktop app) moves to the nearest preset in
// that direction, and the ends of the ladder simply stay put.
export const stepPreset = (options: readonly number[], value: number, dir: 1 | -1): number => {
  const sorted = [...options].sort((a, b) => a - b);
  if (dir > 0) {
    const next = sorted.find((option) => option > value + 1e-9);
    return next === undefined ? value : next;
  }
  const lower = sorted.filter((option) => option < value - 1e-9);
  return lower.length === 0 ? value : lower[lower.length - 1];
};
