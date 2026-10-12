import { DashboardSizing, normalizeSizing } from "../hooks/useDashboardSizing";
import { isPaneLayout } from "./paneLayoutShape";
import type { LayoutState } from "../components/CenterPaneLayoutDemo";

// Four one-tap layouts for the top bar. A slot is a snapshot of everything a
// layout means to the person: the dashboard's column widths, density and
// screen layout, the page zoom, and which panes show what (and where their
// dividers are). Snapshots rather than references to named presets, so editing
// or deleting a preset elsewhere never changes a slot.
export const QUICK_SLOT_COUNT = 4;
export const QUICK_SLOTS_KEY = "ugs-dashboard-quick-layouts";

export const QUICK_COLORS = [
  { id: "green", label: "Green", hex: "#22c55e" },
  { id: "blue", label: "Blue", hex: "#3b82f6" },
  { id: "orange", label: "Orange", hex: "#f59e0b" },
  { id: "red", label: "Red", hex: "#ef4444" },
  { id: "purple", label: "Purple", hex: "#a855f7" },
  { id: "teal", label: "Teal", hex: "#14b8a6" },
  { id: "pink", label: "Pink", hex: "#ec4899" },
  { id: "gray", label: "Gray", hex: "#94a3b8" },
] as const;

export type QuickColorId = (typeof QUICK_COLORS)[number]["id"];
export const DEFAULT_QUICK_COLOR: QuickColorId = "blue";

export type QuickSlot = {
  color: QuickColorId;
  sizing: DashboardSizing;
  zoom: number;
  // null when no pane layout had been saved yet; recalling then leaves the panes alone.
  panes: LayoutState | null;
};

export type QuickSlots = (QuickSlot | null)[];

export const emptyQuickSlots = (): QuickSlots => Array.from({ length: QUICK_SLOT_COUNT }, () => null);

const isColor = (value: unknown): value is QuickColorId =>
  QUICK_COLORS.some((color) => color.id === value);

export const colorHex = (color: QuickColorId): string =>
  QUICK_COLORS.find((candidate) => candidate.id === color)?.hex ?? "#3b82f6";

const validZoom = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value) && value >= 70 && value <= 150;

// Anything read from storage (or later a file) is validated slot by slot: a bad
// one is dropped to empty without disturbing the others, and the result always
// has exactly QUICK_SLOT_COUNT entries.
export const parseQuickSlots = (data: unknown): QuickSlots => {
  const slots = emptyQuickSlots();
  if (!Array.isArray(data)) return slots;
  for (let index = 0; index < QUICK_SLOT_COUNT; index++) {
    const raw = data[index] as Partial<QuickSlot> | null | undefined;
    if (!raw || typeof raw !== "object" || !validZoom(raw.zoom)) continue;
    slots[index] = {
      color: isColor(raw.color) ? raw.color : DEFAULT_QUICK_COLOR,
      sizing: normalizeSizing(raw.sizing),
      zoom: raw.zoom,
      panes: isPaneLayout(raw.panes) ? raw.panes : null,
    };
  }
  return slots;
};

export const makeQuickSlot = (
  color: QuickColorId,
  sizing: DashboardSizing,
  zoom: number,
  panes: LayoutState | null
): QuickSlot => ({ color, sizing: normalizeSizing(sizing), zoom, panes });

// Whether the dashboard is showing exactly what this slot holds right now (used
// to mark the active slot). Pane layouts are compared whole, so moving a
// divider afterwards, correctly, un-marks it.
export const quickSlotMatches = (
  slot: QuickSlot | null,
  sizing: DashboardSizing,
  zoom: number,
  panes: LayoutState | null
): boolean => {
  if (!slot) return false;
  const a = normalizeSizing(sizing);
  const b = slot.sizing;
  return (
    slot.zoom === zoom &&
    a.compact === b.compact &&
    a.leftWidth === b.leftWidth &&
    a.rightWidth === b.rightWidth &&
    (a.layoutMode ?? "auto") === (b.layoutMode ?? "auto") &&
    (slot.panes === null || JSON.stringify(slot.panes) === JSON.stringify(panes))
  );
};
