import { useEffect, useState } from "react";
import type { LayoutState } from "../components/CenterPaneLayoutDemo";

export const PANE_LAYOUT_PRESETS_KEY = "ugs-dashboard-pane-layout-presets";
export const PANE_LAYOUT_CURRENT_KEY = "ugs-dashboard-current-pane-layout";
export const PANE_LAYOUT_CHANGE_EVENT = "ugs-pane-layouts-changed";
export const PANE_LAYOUT_APPLY_EVENT = "ugs-pane-layout-apply";

export type PaneLayoutPreset = { name: string; layout: LayoutState };

export const isPaneLayout = (value: unknown): value is LayoutState => {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<LayoutState>;
  return Array.isArray(candidate.panes) && candidate.panes.length > 0 &&
    candidate.panes.length <= 4 && candidate.panes.every(pane =>
      pane && typeof pane.id === "number" && typeof pane.content === "string" && pane.rect &&
      typeof pane.rect.x0 === "number" && typeof pane.rect.x1 === "number" &&
      typeof pane.rect.y0 === "number" && typeof pane.rect.y1 === "number") &&
    !!candidate.sizes && Object.values(candidate.sizes).every(size => typeof size === "number" && Number.isFinite(size));
};

// Shared with the layout backup import, so a file is held to the same rules as saved presets.
export const parsePaneLayoutPresets = (data: unknown): PaneLayoutPreset[] => {
  if (!Array.isArray(data)) return [];
  return data.filter(item => item && typeof item.name === "string" && item.name.trim() && isPaneLayout(item.layout))
    .map(item => ({ name: item.name.trim(), layout: item.layout }));
};

const readPresets = (): PaneLayoutPreset[] => {
  try {
    return parsePaneLayoutPresets(JSON.parse(localStorage.getItem(PANE_LAYOUT_PRESETS_KEY) ?? "[]"));
  } catch {
    return [];
  }
};

export const readCurrentPaneLayout = (): LayoutState | null => {
  try {
    const value = JSON.parse(localStorage.getItem(PANE_LAYOUT_CURRENT_KEY) ?? "null");
    return isPaneLayout(value) ? value : null;
  } catch {
    return null;
  }
};

export const persistCurrentPaneLayout = (layout: LayoutState) => {
  try {
    localStorage.setItem(PANE_LAYOUT_CURRENT_KEY, JSON.stringify(layout));
    window.dispatchEvent(new Event(PANE_LAYOUT_CHANGE_EVENT));
  } catch {
    // Preset saving reports storage errors; the live layout remains usable if
    // browser storage is unavailable.
  }
};

export const applyPaneLayout = (layout: LayoutState) => {
  window.dispatchEvent(new CustomEvent(PANE_LAYOUT_APPLY_EVENT, { detail: { layout } }));
};

export function usePaneLayoutPresets() {
  const [presets, setPresets] = useState<PaneLayoutPreset[]>(readPresets);
  const [current, setCurrent] = useState<LayoutState | null>(readCurrentPaneLayout);
  const [error, setError] = useState("");

  useEffect(() => {
    const refresh = () => {
      setPresets(readPresets());
      setCurrent(readCurrentPaneLayout());
    };
    window.addEventListener(PANE_LAYOUT_CHANGE_EVENT, refresh);
    return () => window.removeEventListener(PANE_LAYOUT_CHANGE_EVENT, refresh);
  }, []);

  const save = (next: PaneLayoutPreset[]) => {
    try {
      localStorage.setItem(PANE_LAYOUT_PRESETS_KEY, JSON.stringify(next));
      setPresets(next);
      setError("");
      window.dispatchEvent(new Event(PANE_LAYOUT_CHANGE_EVENT));
      return true;
    } catch {
      setError("Could not save pane layouts in this browser. Check that browser storage is available.");
      return false;
    }
  };

  return { presets, current, save, error };
}
