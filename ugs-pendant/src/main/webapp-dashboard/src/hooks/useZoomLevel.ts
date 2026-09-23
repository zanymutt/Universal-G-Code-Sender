import { useCallback, useEffect, useState } from "react";

export const ZOOM_STORAGE_KEY = "ugs-dashboard-zoom";
const STORAGE_KEY = ZOOM_STORAGE_KEY;
export const MIN_ZOOM = 70;
export const MAX_ZOOM = 150;
const STEP = 5;
const DEFAULT_ZOOM = 100;

function readStoredZoom(): number {
  const stored = Number(localStorage.getItem(STORAGE_KEY));
  return Number.isFinite(stored) && stored >= MIN_ZOOM && stored <= MAX_ZOOM ? stored : DEFAULT_ZOOM;
}

// Whole-page zoom for touchscreens of different sizes/distances, persisted
// so it survives a reload. Setting the CSS `zoom` property on body/html
// looks right at first but doesn't actually match a real browser zoom: it
// shrinks or grows the page in place without changing what 100vh/100vw
// mean, so the content just shrinks into a corner instead of reflowing to
// fill the (now effectively bigger or smaller) window - confirmed visually
// against a real ctrl+/- zoom. Setting this variable instead drives a
// scale transform in App.scss on a deliberately oversized/undersized `.app`
// box, which does reflow to fill the window - see the comment there.
export function useZoomLevel() {
  const [zoom, setZoom] = useState(readStoredZoom);

  useEffect(() => {
    document.documentElement.style.setProperty("--dashboard-zoom", String(zoom / 100));
    // Only promotes .app to a composited layer (see the App.scss comment on
    // this class) once zoom actually differs from 100% - so the untouched,
    // by-far-most-common case has no transform on it at all, not merely a
    // numeric no-op scale(1).
    document.documentElement.classList.toggle("dashboard-zoomed", zoom !== DEFAULT_ZOOM);
    localStorage.setItem(STORAGE_KEY, String(zoom));
  }, [zoom]);

  const zoomIn = useCallback(() => setZoom((z) => Math.min(MAX_ZOOM, z + STEP)), []);
  const zoomOut = useCallback(() => setZoom((z) => Math.max(MIN_ZOOM, z - STEP)), []);

  const resetZoom = useCallback(() => setZoom(DEFAULT_ZOOM), []);
  const applyZoom = useCallback((value: number) => {
    if (Number.isFinite(value)) setZoom(Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, value)));
  }, []);
  return { zoom, zoomIn, zoomOut, resetZoom, applyZoom, canZoomIn: zoom < MAX_ZOOM, canZoomOut: zoom > MIN_ZOOM };
}
