import { useState } from "react";
import { DashboardSizing, normalizeSizing } from "./useDashboardSizing";

export const LAYOUT_PRESETS_KEY = "ugs-dashboard-layout-presets";
const KEY = LAYOUT_PRESETS_KEY;
export type LayoutPreset = DashboardSizing & { name: string; zoom: number };
// Shared with the layout backup import, so a file is held to the same rules as saved presets.
export const parseLayoutPresets = (data: unknown): LayoutPreset[] => {
  if (!Array.isArray(data)) return [];
  return data.filter(p => p && typeof p.name === "string" && p.name.trim() &&
    typeof p.zoom === "number" && Number.isFinite(p.zoom) && p.zoom >= 70 && p.zoom <= 150)
    .map(p => ({ ...normalizeSizing(p), name: p.name.trim(), zoom: p.zoom }));
};
export function useLayoutPresets() {
  const [error, setError] = useState("");
  const [presets, setPresets] = useState<LayoutPreset[]>(() => {
    try { return parseLayoutPresets(JSON.parse(localStorage.getItem(KEY) ?? "[]")); }
    catch { return []; }
  });
  const save = (next: LayoutPreset[]) => {
    try {
      localStorage.setItem(KEY, JSON.stringify(next));
      setPresets(next);
      setError("");
      return true;
    } catch {
      setError("Could not save presets in this browser. Check that browser storage is available.");
      return false;
    }
  };
  return { presets, save, error };
}
