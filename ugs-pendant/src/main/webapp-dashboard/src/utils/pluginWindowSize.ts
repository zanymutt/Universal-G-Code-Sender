export type PluginWindowSize = { width: number; height: number };

export const PLUGIN_WINDOW_SIZE_PREFIX = "ugs.dashboard.pluginWindowSize.";
const keyFor = (pluginId: string) => `${PLUGIN_WINDOW_SIZE_PREFIX}${pluginId}`;

// Deliberately generous: this only guards against a corrupt or absurd stored
// value (the CSS max-width/max-height clamp the window to the viewport anyway).
const MIN_SIDE = 100;
const MAX_SIDE = 10000;

const isSide = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value) && value >= MIN_SIDE && value <= MAX_SIDE;

// Wrapped because localStorage can be missing or throw (private windows,
// blocked site data) - the window just opens at its default size then.
export const loadPluginWindowSize = (pluginId: string): PluginWindowSize | null => {
  try {
    const parsed = JSON.parse(window.localStorage.getItem(keyFor(pluginId)) ?? "null");
    return parsed && isSide(parsed.width) && isSide(parsed.height)
      ? { width: parsed.width, height: parsed.height }
      : null;
  } catch {
    return null;
  }
};

export const savePluginWindowSize = (pluginId: string, size: PluginWindowSize) => {
  if (!isSide(size.width) || !isSide(size.height)) return;
  try {
    window.localStorage.setItem(
      keyFor(pluginId),
      JSON.stringify({ width: Math.round(size.width), height: Math.round(size.height) })
    );
  } catch {
    // Not persisting is fine.
  }
};
