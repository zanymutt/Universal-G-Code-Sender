import { useState } from "react";
import { DashboardSizing, normalizeSizing } from "./useDashboardSizing";

const KEY = "ugs-dashboard-layout-presets";
export type LayoutPreset = DashboardSizing & { name: string; zoom: number };
export function useLayoutPresets() {
  const [error, setError] = useState("");
  const [presets, setPresets] = useState<LayoutPreset[]>(() => {
    try {
      const data: unknown = JSON.parse(localStorage.getItem(KEY) ?? "[]");
      if (!Array.isArray(data)) return [];
      return data.filter(p => p && typeof p.name === "string" && p.name.trim() &&
        typeof p.zoom === "number" && Number.isFinite(p.zoom) && p.zoom >= 70 && p.zoom <= 150)
        .map(p => ({ ...normalizeSizing(p), name: p.name.trim(), zoom: p.zoom }));
    } catch { return []; }
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
