import { useCallback, useEffect, useState } from "react";

const STORAGE_KEY = "ugs-dashboard-editor-font-size";
// Same-page sync only - the native "storage" event exists for this already,
// but only fires in *other* tabs/windows, never the one that made the
// change (see this hook's own multi-instance comment below).
const CHANGE_EVENT = "ugs-dashboard-editor-font-size-changed";
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
//
// Called from more than one place (the main editor and the macro gcode
// field, which stays mounted once a macro's selected) - each call is its
// own independent useState, so without the event below, the +/- control in
// one would silently leave every other already-mounted instance showing
// the old size until it happened to remount (confirmed: this is exactly
// what shipped broken the first time - the macro editor's font size just
// didn't move when the Edit tab's control was used).
export function useEditorFontSize() {
  const [fontSize, setFontSize] = useState(readStoredFontSize);

  useEffect(() => {
    const onChange = () => setFontSize(readStoredFontSize());
    window.addEventListener(CHANGE_EVENT, onChange);
    return () => window.removeEventListener(CHANGE_EVENT, onChange);
  }, []);

  const step = useCallback((delta: number) => {
    setFontSize((size) => {
      const next = Math.min(MAX_FONT_SIZE, Math.max(MIN_FONT_SIZE, size + delta));
      localStorage.setItem(STORAGE_KEY, String(next));
      window.dispatchEvent(new Event(CHANGE_EVENT));
      return next;
    });
  }, []);

  const increase = useCallback(() => step(STEP), [step]);
  const decrease = useCallback(() => step(-STEP), [step]);

  return {
    fontSize,
    increase,
    decrease,
    canIncrease: fontSize < MAX_FONT_SIZE,
    canDecrease: fontSize > MIN_FONT_SIZE,
  };
}
