import { useCallback, useState } from "react";
import {
  DEFAULT_TILE_MODE,
  parseIdList,
  parseTileMode,
  PLUGIN_TILE_MODE_KEY,
  PLUGIN_UNPINNED_KEY,
  RAIL_COLLAPSED_KEY,
  TileMode,
  toggleCollapsed,
  togglePin,
} from "../utils/pluginPins";

const readJson = (key: string): unknown => {
  try {
    return JSON.parse(localStorage.getItem(key) ?? "null");
  } catch {
    return null;
  }
};

const write = (key: string, value: unknown) => {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Session-only if browser storage is unavailable.
  }
};

// Which plugins the person has unpinned from the rail.
export function usePluginPins() {
  const [unpinned, setUnpinned] = useState<string[]>(() => parseIdList(readJson(PLUGIN_UNPINNED_KEY)));
  const toggle = useCallback((id: string) => {
    setUnpinned((current) => {
      const next = togglePin(current, id);
      write(PLUGIN_UNPINNED_KEY, next);
      return next;
    });
  }, []);
  return { unpinned, toggle };
}

// Whether the rail shows plugins as icon tiles or as named buttons.
export function usePluginTileMode() {
  const [mode, setModeState] = useState<TileMode>(() => {
    try {
      return parseTileMode(JSON.parse(localStorage.getItem(PLUGIN_TILE_MODE_KEY) ?? "null"));
    } catch {
      return DEFAULT_TILE_MODE;
    }
  });
  const setMode = useCallback((next: TileMode) => {
    setModeState(next);
    write(PLUGIN_TILE_MODE_KEY, next);
  }, []);
  return { mode, setMode };
}

// Which right-rail sections are folded away.
export function useRailCollapsed() {
  const [collapsed, setCollapsed] = useState<string[]>(() => parseIdList(readJson(RAIL_COLLAPSED_KEY)));
  const toggle = useCallback((id: string) => {
    setCollapsed((current) => {
      const next = toggleCollapsed(current, id);
      write(RAIL_COLLAPSED_KEY, next);
      return next;
    });
  }, []);
  return { collapsed, toggle, isCollapsed: (id: string) => collapsed.includes(id) };
}
