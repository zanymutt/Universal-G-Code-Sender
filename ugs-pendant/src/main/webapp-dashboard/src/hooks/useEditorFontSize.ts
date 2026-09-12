import { useCallback, useEffect, useState } from "react";

const STORAGE_KEY = "ugs-dashboard-editor-font-size";
const MIN_FONT_SIZE = 12;
const MAX_FONT_SIZE = 28;
const STEP = 2;
// Matches the editor's previous fixed size (0.9rem, i.e. 14.4px off a 16px
// root) closely enough that upgrading doesn't visibly jump the very first
// time this loads with nothing in storage yet.
const DEFAULT_FONT_SIZE = 14;

function readStoredFontSize(): number {
  const stored = Number(localStorage.getItem(STORAGE_KEY));
  return Number.isFinite(stored) && stored >= MIN_FONT_SIZE && stored <= MAX_FONT_SIZE
    ? stored
    : DEFAULT_FONT_SIZE;
}

// Deliberately independent of useZoomLevel's whole-page zoom (a transform:
// scale() on .app - see App.scss) rather than an inverse-transform trick
// riding on top of it: this sets the editor's own font-size directly, so
// there's no scaling math in the path at all and the gcode text is exactly
// as crisp at any size here as the rest of the page is at 100% zoom -
// deliberate, since unlike the general UI chrome, misreading a character in
// the actual gcode is the whole reason this exists.
export function useEditorFontSize() {
  const [fontSize, setFontSize] = useState(readStoredFontSize);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, String(fontSize));
  }, [fontSize]);

  const increase = useCallback(() => setFontSize((size) => Math.min(MAX_FONT_SIZE, size + STEP)), []);
  const decrease = useCallback(() => setFontSize((size) => Math.max(MIN_FONT_SIZE, size - STEP)), []);

  return {
    fontSize,
    increase,
    decrease,
    canIncrease: fontSize < MAX_FONT_SIZE,
    canDecrease: fontSize > MIN_FONT_SIZE,
  };
}
