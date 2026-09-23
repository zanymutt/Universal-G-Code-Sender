import { useEffect, useState } from "react";

export const SIZING_KEY = "ugs-dashboard-sizing";
const KEY = SIZING_KEY;
export type DashboardSizing = { compact: boolean; leftWidth: number; rightWidth: number; layoutMode?: "auto" | "desktop" | "tablet" | "tabbed" };
export const DEFAULT_SIZING: DashboardSizing = { compact: false, leftWidth: 360, rightWidth: 360 };
const width = (value: unknown, fallback: number) =>
  typeof value === "number" && Number.isFinite(value) ? Math.round(Math.max(260, Math.min(420, value))) : fallback;
export function normalizeSizing(value: unknown): DashboardSizing {
  const saved = value && typeof value === "object" ? value as Partial<DashboardSizing> : {};
  return { layoutMode: ["auto", "desktop", "tablet", "tabbed"].includes(saved.layoutMode ?? "") ? saved.layoutMode : "auto", compact: saved.compact === true,
    leftWidth: width(saved.leftWidth, 360), rightWidth: width(saved.rightWidth, 360) };
}
export function useDashboardSizing() {
  const [sizing, setSizing] = useState<DashboardSizing>(() => {
    try { return normalizeSizing(JSON.parse(localStorage.getItem(KEY) ?? "null")); }
    catch { return DEFAULT_SIZING; }
  });
  useEffect(() => {
    const root = document.documentElement;
    root.dataset.dashboardDensity = sizing.compact ? "compact" : "comfortable";
    root.dataset.dashboardLayout = sizing.layoutMode ?? "auto";
    root.style.setProperty("--dashboard-left-width", sizing.leftWidth + "px");
    root.style.setProperty("--dashboard-right-width", sizing.rightWidth + "px");
    try { localStorage.setItem(KEY, JSON.stringify(sizing)); } catch { /* Session-only if storage is unavailable. */ }
  }, [sizing]);
  return { sizing, setSizing };
}
