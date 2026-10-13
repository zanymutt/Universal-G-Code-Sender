// Which plugins show on the right rail, how they are drawn, and which rail
// sections are folded. All of it is a per-device preference.
//
// The pin list is stored as the plugins the person has UNPINNED, not the ones
// they pinned, so a plugin installed later shows up pinned by default instead
// of silently landing only in the "all plugins" grid.

export const PLUGIN_UNPINNED_KEY = "ugs-dashboard-plugins-unpinned";
export const PLUGIN_TILE_MODE_KEY = "ugs-dashboard-plugin-tiles";
export const RAIL_COLLAPSED_KEY = "ugs-dashboard-rail-collapsed";

export type TileMode = "icons" | "names";
export const DEFAULT_TILE_MODE: TileMode = "names";

const MAX_IDS = 200;

// A stored list of ids: only strings, no duplicates, bounded.
export const parseIdList = (raw: unknown): string[] => {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  for (const value of raw) {
    if (typeof value === "string" && value.length > 0 && value.length <= 200) seen.add(value);
    if (seen.size >= MAX_IDS) break;
  }
  return [...seen];
};

export const parseTileMode = (raw: unknown): TileMode => (raw === "icons" ? "icons" : DEFAULT_TILE_MODE);

export const isPinned = (unpinned: readonly string[], id: string) => !unpinned.includes(id);

// Flips one plugin's pin, returning a new list.
export const togglePin = (unpinned: readonly string[], id: string): string[] =>
  unpinned.includes(id) ? unpinned.filter((existing) => existing !== id) : [...unpinned, id];

type Named = { id: string; name: string; description?: string };

export const pinnedPlugins = <T extends Named>(plugins: readonly T[], unpinned: readonly string[]): T[] =>
  plugins.filter((plugin) => isPinned(unpinned, plugin.id));

// For the grid's search box: every word typed must appear in the name or
// description, in any order, ignoring case.
export const filterPlugins = <T extends Named>(plugins: readonly T[], query: string): T[] => {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length === 0) return [...plugins];
  return plugins.filter((plugin) => {
    const haystack = `${plugin.name} ${plugin.description ?? ""}`.toLowerCase();
    return words.every((word) => haystack.includes(word));
  });
};

// A plugin with no icon of its own still needs a recognisable tile: its
// initials (two words: both first letters; one word: its first two letters).
export const pluginInitials = (name: string): string => {
  const words = name.trim().split(/[\s_-]+/).filter(Boolean);
  const letters = (value: string) => value.replace(/[^\p{L}\p{N}]/gu, "");
  if (words.length >= 2) {
    const a = letters(words[0])[0];
    const b = letters(words[1])[0];
    if (a && b) return (a + b).toUpperCase();
  }
  const only = letters(words[0] ?? "");
  if (only.length === 0) return "?";
  return only.length === 1 ? only.toUpperCase() : only[0].toUpperCase() + only[1].toLowerCase();
};

// A stable colour per plugin id (so a tile keeps its colour between visits and
// two plugins are unlikely to share one): a hue 0-359.
export const pluginHue = (id: string): number => {
  let hash = 5381;
  for (let i = 0; i < id.length; i++) hash = ((hash << 5) + hash + id.charCodeAt(i)) | 0;
  return Math.abs(hash) % 360;
};

export const toggleCollapsed = (collapsed: readonly string[], id: string): string[] =>
  collapsed.includes(id) ? collapsed.filter((existing) => existing !== id) : [...collapsed, id];
