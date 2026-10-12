// The preset values offered by the Jog pad's step-size and feed-rate selectors.
// Shared so the keyboard "step up / step down" actions walk the same ladder the
// on-screen buttons show.
export const STEP_SIZE_OPTIONS = [0.01, 0.1, 1, 10, 100, 1000];
export const FEED_RATE_OPTIONS = [10, 100, 500, 1000, 2000, 5000];

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
