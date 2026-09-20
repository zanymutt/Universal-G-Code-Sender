import type { PluginInfo } from "../services/plugins";

type PluginWindowEntry = { key: number; plugin: PluginInfo; focusRequest: number; minimized: boolean };
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
  | { type: "close"; key: number };

// The window that should take the front after `key` stops being visible
// (closed or minimized): the last remaining un-minimized one, if any.
const nextFrontKey = (state: PluginWindowsState, windows: PluginWindowEntry[], leavingKey: number) =>
  state.frontKey === leavingKey
    ? windows.filter(w => !w.minimized && w.key !== leavingKey).pop()?.key ?? null
    : state.frontKey;

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
      windows: [...state.windows, { key: state.nextKey, plugin: action.plugin, focusRequest: 0, minimized: false }] };
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
  const windows = state.windows.filter(w => w.key !== action.key);
  return { ...state, windows, frontKey: nextFrontKey(state, windows, action.key) };
}
