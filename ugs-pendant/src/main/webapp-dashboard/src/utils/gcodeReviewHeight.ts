// How tall the person has dragged the G-code review panel (null = automatic,
// i.e. up to half the editor). Remembered across sessions in this browser.

export const REVIEW_HEIGHT_STORAGE_KEY = "ugs-dashboard-gcode-review-height";
export const MIN_REVIEW_HEIGHT = 96;
// Always left for the code itself plus the toolbar beneath it, so dragging the
// panel up can never squeeze the editor out of existence.
export const RESERVED_EDITOR_HEIGHT = 140;

export const clampReviewHeight = (height: number, containerHeight: number): number => {
  const max = Math.max(MIN_REVIEW_HEIGHT, containerHeight - RESERVED_EDITOR_HEIGHT);
  return Math.round(Math.max(MIN_REVIEW_HEIGHT, Math.min(height, max)));
};

export const loadReviewHeight = (): number | null => {
  try {
    const value = Number(localStorage.getItem(REVIEW_HEIGHT_STORAGE_KEY));
    return Number.isFinite(value) && value >= MIN_REVIEW_HEIGHT ? Math.round(value) : null;
  } catch {
    return null;
  }
};

export const saveReviewHeight = (height: number | null): void => {
  try {
    if (height === null) localStorage.removeItem(REVIEW_HEIGHT_STORAGE_KEY);
    else localStorage.setItem(REVIEW_HEIGHT_STORAGE_KEY, String(Math.round(height)));
  } catch {
    // Storage unavailable: the size still applies for this page view.
  }
};
