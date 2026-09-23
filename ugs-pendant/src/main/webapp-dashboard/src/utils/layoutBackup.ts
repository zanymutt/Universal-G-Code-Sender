import { LAYOUT_PRESETS_KEY, parseLayoutPresets, type LayoutPreset } from "../hooks/useLayoutPresets";
import {
  PANE_LAYOUT_CURRENT_KEY, PANE_LAYOUT_PRESETS_KEY, isPaneLayout, parsePaneLayoutPresets,
  readCurrentPaneLayout, type PaneLayoutPreset,
} from "../hooks/usePaneLayoutPresets";
import { SIZING_KEY, normalizeSizing, type DashboardSizing } from "../hooks/useDashboardSizing";
import { MAX_ZOOM, MIN_ZOOM, ZOOM_STORAGE_KEY } from "../hooks/useZoomLevel";
import { CONSOLE_FONT_STORAGE_KEY, MAX_FONT_SIZE as MAX_CONSOLE_FONT, MIN_FONT_SIZE as MIN_CONSOLE_FONT } from "../hooks/useConsoleFontSize";
import { EDITOR_FONT_STORAGE_KEY, MAX_FONT_SIZE as MAX_EDITOR_FONT, MIN_FONT_SIZE as MIN_EDITOR_FONT } from "../hooks/useEditorFontSize";
import { PLUGIN_WINDOW_SIZE_PREFIX, loadPluginWindowSize, savePluginWindowSize, type PluginWindowSize } from "./pluginWindowSize";
import type { LayoutState } from "../components/CenterPaneLayoutDemo";

// A backup of this device's layout state. Everything here lives in localStorage, which is per
// browser *and* per address (localhost vs. a LAN IP are separate stores), so this file is also how
// layouts move between devices. Only layout-related state is included - not file browser history,
// simulation settings, or anything else that isn't a layout.
export const BACKUP_APP = "ugs-dashboard-layouts";
export const BACKUP_VERSION = 1;
const MAX_FILE_BYTES = 1024 * 1024;
const MAX_PRESETS = 200;

export type LayoutBackupSettings = {
  sizing?: DashboardSizing;
  zoom?: number;
  consoleFontSize?: number;
  editorFontSize?: number;
  paneLayout?: LayoutState;
  pluginWindowSizes?: Record<string, PluginWindowSize>;
};

export type LayoutBackup = {
  app: typeof BACKUP_APP;
  version: number;
  exportedAt: string;
  paneLayoutPresets: PaneLayoutPreset[];
  layoutPresets: LayoutPreset[];
  settings: LayoutBackupSettings;
};

export type ParsedBackup = { backup: LayoutBackup; skipped: number };
export type ParseResult = { ok: true; value: ParsedBackup } | { ok: false; error: string };
export type ImportSelection = { paneLayoutPresets: boolean; layoutPresets: boolean; settings: boolean };
export type ImportReport = { added: number; replaced: number; settingsApplied: boolean };

const readJson = (key: string): unknown => {
  try { return JSON.parse(localStorage.getItem(key) ?? "null"); } catch { return null; }
};

const inRange = (value: unknown, min: number, max: number): value is number =>
  typeof value === "number" && Number.isFinite(value) && value >= min && value <= max;

const readStoredNumber = (key: string, min: number, max: number): number | undefined => {
  try {
    const raw = localStorage.getItem(key);
    if (raw === null) return undefined;
    const value = Number(raw);
    return inRange(value, min, max) ? value : undefined;
  } catch { return undefined; }
};

const storedPluginIds = (): string[] => {
  const ids: string[] = [];
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key?.startsWith(PLUGIN_WINDOW_SIZE_PREFIX)) ids.push(key.slice(PLUGIN_WINDOW_SIZE_PREFIX.length));
    }
  } catch { /* Storage unavailable: nothing to back up. */ }
  return ids;
};

export const buildLayoutBackup = (): LayoutBackup => {
  const settings: LayoutBackupSettings = {};
  const sizing = readJson(SIZING_KEY);
  if (sizing) settings.sizing = normalizeSizing(sizing);
  settings.zoom = readStoredNumber(ZOOM_STORAGE_KEY, MIN_ZOOM, MAX_ZOOM);
  settings.consoleFontSize = readStoredNumber(CONSOLE_FONT_STORAGE_KEY, MIN_CONSOLE_FONT, MAX_CONSOLE_FONT);
  settings.editorFontSize = readStoredNumber(EDITOR_FONT_STORAGE_KEY, MIN_EDITOR_FONT, MAX_EDITOR_FONT);
  settings.paneLayout = readCurrentPaneLayout() ?? undefined;
  const pluginWindowSizes: Record<string, PluginWindowSize> = {};
  for (const id of storedPluginIds()) {
    const size = loadPluginWindowSize(id);
    if (size) pluginWindowSizes[id] = size;
  }
  if (Object.keys(pluginWindowSizes).length) settings.pluginWindowSizes = pluginWindowSizes;
  return {
    app: BACKUP_APP,
    version: BACKUP_VERSION,
    exportedAt: new Date().toISOString(),
    paneLayoutPresets: parsePaneLayoutPresets(readJson(PANE_LAYOUT_PRESETS_KEY)),
    layoutPresets: parseLayoutPresets(readJson(LAYOUT_PRESETS_KEY)),
    settings,
  };
};

// Presets with the same name (case-insensitive) are replaced by the imported one; the rest are kept.
const mergeByName = <T extends { name: string }>(existing: T[], incoming: T[]) => {
  const merged = [...existing];
  let added = 0;
  let replaced = 0;
  for (const item of incoming) {
    const index = merged.findIndex(other => other.name.toLowerCase() === item.name.toLowerCase());
    if (index >= 0) { merged[index] = item; replaced++; } else { merged.push(item); added++; }
  }
  return { merged, added, replaced };
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === "object" && !Array.isArray(value);

// Validates a backup file with the same rules the app applies to its own stored presets, dropping
// (and counting) anything invalid rather than rejecting the whole file for one bad entry.
export const parseLayoutBackup = (text: string): ParseResult => {
  if (text.length > MAX_FILE_BYTES) return { ok: false, error: "That file is too large to be a layout backup." };
  let data: unknown;
  try { data = JSON.parse(text); } catch { return { ok: false, error: "That file is not valid JSON." }; }
  if (!isRecord(data) || data.app !== BACKUP_APP) {
    return { ok: false, error: "That file is not a UGS Dashboard layout backup." };
  }
  if (typeof data.version !== "number" || data.version > BACKUP_VERSION) {
    return { ok: false, error: "That backup was made by a newer version of the Dashboard. Update the Dashboard first." };
  }
  const rawPane = Array.isArray(data.paneLayoutPresets) ? data.paneLayoutPresets : [];
  const rawLayout = Array.isArray(data.layoutPresets) ? data.layoutPresets : [];
  if (rawPane.length > MAX_PRESETS || rawLayout.length > MAX_PRESETS) {
    return { ok: false, error: "That backup contains too many saved layouts." };
  }
  const paneLayoutPresets = parsePaneLayoutPresets(rawPane);
  const layoutPresets = parseLayoutPresets(rawLayout);
  let skipped = (rawPane.length - paneLayoutPresets.length) + (rawLayout.length - layoutPresets.length);

  const settings: LayoutBackupSettings = {};
  const raw = isRecord(data.settings) ? data.settings : {};
  if (isRecord(raw.sizing)) settings.sizing = normalizeSizing(raw.sizing);
  if (raw.zoom !== undefined) {
    if (inRange(raw.zoom, MIN_ZOOM, MAX_ZOOM)) settings.zoom = raw.zoom; else skipped++;
  }
  if (raw.consoleFontSize !== undefined) {
    if (inRange(raw.consoleFontSize, MIN_CONSOLE_FONT, MAX_CONSOLE_FONT)) settings.consoleFontSize = raw.consoleFontSize; else skipped++;
  }
  if (raw.editorFontSize !== undefined) {
    if (inRange(raw.editorFontSize, MIN_EDITOR_FONT, MAX_EDITOR_FONT)) settings.editorFontSize = raw.editorFontSize; else skipped++;
  }
  if (raw.paneLayout !== undefined) {
    if (isPaneLayout(raw.paneLayout)) settings.paneLayout = raw.paneLayout; else skipped++;
  }
  if (isRecord(raw.pluginWindowSizes)) {
    const sizes: Record<string, PluginWindowSize> = {};
    for (const [id, size] of Object.entries(raw.pluginWindowSizes)) {
      // Plugin ids are folder names; refuse anything that could not be one rather than store it.
      if (/^[A-Za-z0-9._-]{1,100}$/.test(id) && isRecord(size) && inRange(size.width, 100, 10000) && inRange(size.height, 100, 10000)) {
        sizes[id] = { width: size.width, height: size.height };
      } else skipped++;
    }
    if (Object.keys(sizes).length) settings.pluginWindowSizes = sizes;
  }
  return {
    ok: true,
    value: {
      backup: {
        app: BACKUP_APP, version: data.version,
        exportedAt: typeof data.exportedAt === "string" ? data.exportedAt : "",
        paneLayoutPresets, layoutPresets, settings,
      },
      skipped,
    },
  };
};

export const hasSettings = (settings: LayoutBackupSettings) => Object.keys(settings).length > 0;

// Writes the chosen parts to localStorage. Throws if storage is unavailable; localStorage has no
// transactions, so a failure part-way can leave the import partly applied.
export const applyLayoutBackup = (backup: LayoutBackup, selection: ImportSelection): ImportReport => {
  let added = 0;
  let replaced = 0;
  if (selection.paneLayoutPresets && backup.paneLayoutPresets.length) {
    const result = mergeByName(parsePaneLayoutPresets(readJson(PANE_LAYOUT_PRESETS_KEY)), backup.paneLayoutPresets);
    localStorage.setItem(PANE_LAYOUT_PRESETS_KEY, JSON.stringify(result.merged));
    added += result.added; replaced += result.replaced;
  }
  if (selection.layoutPresets && backup.layoutPresets.length) {
    const result = mergeByName(parseLayoutPresets(readJson(LAYOUT_PRESETS_KEY)), backup.layoutPresets);
    localStorage.setItem(LAYOUT_PRESETS_KEY, JSON.stringify(result.merged));
    added += result.added; replaced += result.replaced;
  }
  let settingsApplied = false;
  if (selection.settings && hasSettings(backup.settings)) {
    const { sizing, zoom, consoleFontSize, editorFontSize, paneLayout, pluginWindowSizes } = backup.settings;
    if (sizing) localStorage.setItem(SIZING_KEY, JSON.stringify(sizing));
    if (zoom !== undefined) localStorage.setItem(ZOOM_STORAGE_KEY, String(zoom));
    if (consoleFontSize !== undefined) localStorage.setItem(CONSOLE_FONT_STORAGE_KEY, String(consoleFontSize));
    if (editorFontSize !== undefined) localStorage.setItem(EDITOR_FONT_STORAGE_KEY, String(editorFontSize));
    if (paneLayout) localStorage.setItem(PANE_LAYOUT_CURRENT_KEY, JSON.stringify(paneLayout));
    for (const [id, size] of Object.entries(pluginWindowSizes ?? {})) savePluginWindowSize(id, size);
    settingsApplied = true;
  }
  return { added, replaced, settingsApplied };
};

export const layoutBackupFilename = () => `ugs-dashboard-layouts-${new Date().toISOString().slice(0, 10)}.json`;

export const downloadLayoutBackup = () => {
  const blob = new Blob([JSON.stringify(buildLayoutBackup(), null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = layoutBackupFilename();
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
};
