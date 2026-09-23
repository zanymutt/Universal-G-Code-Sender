import { useCallback, useEffect, useState } from "react";

export const CONSOLE_FONT_STORAGE_KEY = "ugs-dashboard-console-font-size";
const STORAGE_KEY = CONSOLE_FONT_STORAGE_KEY;
export const MIN_FONT_SIZE = 10;
export const MAX_FONT_SIZE = 24;
const STEP = 2;
// Matches the console's previous fixed size (0.85rem, i.e. 13.6px off a
// 16px root) closely enough that upgrading doesn't visibly jump the first
// time this loads with nothing in storage yet.
const DEFAULT_FONT_SIZE = 14;

function readStoredFontSize(): number {
  const stored = Number(localStorage.getItem(STORAGE_KEY));
  return Number.isFinite(stored) && stored >= MIN_FONT_SIZE && stored <= MAX_FONT_SIZE
    ? stored
    : DEFAULT_FONT_SIZE;
}

// Deliberately independent of useEditorFontSize, not shared with it - the
// console is a scrolling log you're monitoring (more lines visible at once
// generally wins) rather than a single place you're reading/editing
// carefully (bigger generally wins), and unlike the macro editor (only
// alongside the main one in Split mode), the console sits right below the
// editor in the normal view - sharing one size would just pick a single
// compromise for two different jobs instead of actually removing a
// mismatch.
export function useConsoleFontSize() {
  const [fontSize, setFontSize] = useState(readStoredFontSize);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, String(fontSize));
  }, [fontSize]);

  const increase = useCallback(() => setFontSize((size) => Math.min(MAX_FONT_SIZE, size + STEP)), []);
  const decrease = useCallback(() => setFontSize((size) => Math.max(MIN_FONT_SIZE, size - STEP)), []);

  return {
    fontSize,
    setExact: (size: number) => setFontSize(Math.max(MIN_FONT_SIZE, Math.min(MAX_FONT_SIZE, size))),
    increase,
    decrease,
    canIncrease: fontSize < MAX_FONT_SIZE,
    canDecrease: fontSize > MIN_FONT_SIZE,
  };
}
