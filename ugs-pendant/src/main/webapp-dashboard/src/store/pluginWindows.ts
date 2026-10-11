import type { PluginInfo } from "../services/plugins";

// dockSlot is null for an ordinary floating window, or the id of a layout slot
// (an element carrying data-plugin-dock-slot="<id>" - see useDockRect) the
// window's iframe is laid over instead. Docking never re-parents the iframe:
// it only changes where the same, always-mounted window is positioned.
type PluginWindowEntry = {
  key: number;
  plugin: PluginInfo;
  focusRequest: number;
  minimized: boolean;
  dockSlot: string | null;
};
export type PluginWindowsState = {
  windows: PluginWindowEntry[];
  frontKey: number | null;
  nextKey: number;
};
export const initialPluginWindows: PluginWindowsState = { windows: [], frontKey: null, nextKey: 0 };
type Action =
  | { type: "open"; plugin: PluginInfo }
  | { type: "activate"; key: number }
  | { type: "minimize"; key: number }
  | { type: "restore"; key: number }
  | { type: "dock"; key: number; slot: string }
  // Open a plugin straight into a slot (reusing its window if it has one).
  | { type: "openDocked"; plugin: PluginInfo; slot: string }
  | { type: "float"; key: number }
  // Hide a docked window without closing it: it keeps running, minimized.
  | { type: "park"; key: number }
  | { type: "close"; key: number };

// The window that should take the front after `key` stops being visible
// (closed or minimized): the last remaining un-minimized one, if any.
const nextFrontKey = (state: PluginWindowsState, windows: PluginWindowEntry[], leavingKey: number) =>
  state.frontKey === leavingKey
    ? windows.filter(w => !w.minimized && w.key !== leavingKey).pop()?.key ?? null
    : state.frontKey;

// Docks window `key` into `slot`. A slot shows one plugin at a time, so
// whatever was docked there before is parked - minimized, floating, still
// running - not closed, so a batch job it was in the middle of keeps going and
// it can be restored later.
function dockInto(
  state: PluginWindowsState,
  windows: PluginWindowEntry[],
  key: number,
  slot: string,
): PluginWindowsState {
  const parked = windows.filter(w => w.key !== key && w.dockSlot === slot).map(w => w.key);
  const next = windows.map(w => {
    if (w.key === key) return { ...w, dockSlot: slot, minimized: false, focusRequest: w.focusRequest + 1 };
    if (parked.includes(w.key)) return { ...w, dockSlot: null, minimized: true };
    return w;
  });
  return { ...state, windows: next, frontKey: state.frontKey !== null && parked.includes(state.frontKey) ? key : state.frontKey };
}

// Keep DOM order stable: moving an iframe in the DOM can reload its document.
// A reducer also handles multiple launches in one React render without duplicate keys.
// Minimizing is a flag on the entry, never a removal - the window (and its
// iframe) stays mounted so the plugin keeps its state, position and size.
export function pluginWindowsReducer(state: PluginWindowsState, action: Action): PluginWindowsState {
  if (action.type === "open") {
    const existing = action.plugin.allowMultipleInstances === true
      ? undefined : state.windows.find(w => w.plugin.id === action.plugin.id);
    if (existing) {
      // Relaunching a minimized plugin brings it back rather than doing nothing.
      return { ...state, frontKey: existing.key,
        windows: state.windows.map(w => w.key === existing.key
          ? { ...w, minimized: false, focusRequest: w.focusRequest + 1 } : w) };
    }
    return { nextKey: state.nextKey + 1, frontKey: state.nextKey,
      windows: [...state.windows, { key: state.nextKey, plugin: action.plugin, focusRequest: 0, minimized: false, dockSlot: null }] };
  }
  if (action.type === "activate") {
    const target = state.windows.find(w => w.key === action.key);
    return state.frontKey === action.key || !target || target.minimized
      ? state : { ...state, frontKey: action.key };
  }
  if (action.type === "minimize") {
    const target = state.windows.find(w => w.key === action.key);
    if (!target || target.minimized) return state;
    const windows = state.windows.map(w => w.key === action.key ? { ...w, minimized: true } : w);
    return { ...state, windows, frontKey: nextFrontKey(state, windows, action.key) };
  }
  if (action.type === "restore") {
    const target = state.windows.find(w => w.key === action.key);
    if (!target || !target.minimized) return state;
    return { ...state, frontKey: action.key,
      windows: state.windows.map(w => w.key === action.key
        ? { ...w, minimized: false, focusRequest: w.focusRequest + 1 } : w) };
  }
  if (action.type === "dock") {
    const target = state.windows.find(w => w.key === action.key);
    if (!target || (target.dockSlot === action.slot && !target.minimized)) return state;
    return dockInto(state, state.windows, action.key, action.slot);
  }
  if (action.type === "openDocked") {
    // One window per plugin, so reuse it wherever it is; a plugin that allows
    // several windows gets a fresh one rather than having one it already has
    // floating pulled out from under whoever is using it.
    const reusable = state.windows.find(w => w.plugin.id === action.plugin.id
      && (action.plugin.allowMultipleInstances !== true || w.dockSlot === action.slot));
    if (reusable) {
      if (reusable.dockSlot === action.slot && !reusable.minimized) return state;
      return dockInto(state, state.windows, reusable.key, action.slot);
    }
    const entry: PluginWindowEntry = { key: state.nextKey, plugin: action.plugin, focusRequest: 0, minimized: false, dockSlot: null };
    return dockInto({ ...state, nextKey: state.nextKey + 1 }, [...state.windows, entry], entry.key, action.slot);
  }
  if (action.type === "park") {
    const target = state.windows.find(w => w.key === action.key);
    if (!target || (target.dockSlot === null && target.minimized)) return state;
    const windows = state.windows.map(w => w.key === action.key ? { ...w, dockSlot: null, minimized: true } : w);
    return { ...state, windows, frontKey: nextFrontKey(state, windows, action.key) };
  }
  if (action.type === "float") {
    const target = state.windows.find(w => w.key === action.key);
    if (!target || target.dockSlot === null) return state;
    return { ...state, frontKey: action.key,
      windows: state.windows.map(w => w.key === action.key
        ? { ...w, dockSlot: null, minimized: false, focusRequest: w.focusRequest + 1 } : w) };
  }
  const windows = state.windows.filter(w => w.key !== action.key);
  return { ...state, windows, frontKey: nextFrontKey(state, windows, action.key) };
}
