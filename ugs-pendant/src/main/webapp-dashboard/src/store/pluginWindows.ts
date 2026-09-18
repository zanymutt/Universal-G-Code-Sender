import type { PluginInfo } from "../services/plugins";

type PluginWindowEntry = { key: number; plugin: PluginInfo; focusRequest: number };
export type PluginWindowsState = {
  windows: PluginWindowEntry[];
  frontKey: number | null;
  nextKey: number;
};
export const initialPluginWindows: PluginWindowsState = { windows: [], frontKey: null, nextKey: 0 };
type Action =
  | { type: "open"; plugin: PluginInfo }
  | { type: "activate"; key: number }
  | { type: "close"; key: number };

// Keep DOM order stable: moving an iframe in the DOM can reload its document.
// A reducer also handles multiple launches in one React render without duplicate keys.
export function pluginWindowsReducer(state: PluginWindowsState, action: Action): PluginWindowsState {
  if (action.type === "open") {
    const existing = action.plugin.allowMultipleInstances === true
      ? undefined : state.windows.find(w => w.plugin.id === action.plugin.id);
    if (existing) {
      return { ...state, frontKey: existing.key,
        windows: state.windows.map(w => w.key === existing.key
          ? { ...w, focusRequest: w.focusRequest + 1 } : w) };
    }
    return { nextKey: state.nextKey + 1, frontKey: state.nextKey,
      windows: [...state.windows, { key: state.nextKey, plugin: action.plugin, focusRequest: 0 }] };
  }
  if (action.type === "activate") {
    return state.frontKey === action.key || !state.windows.some(w => w.key === action.key)
      ? state : { ...state, frontKey: action.key };
  }
  const windows = state.windows.filter(w => w.key !== action.key);
  return { ...state, windows, frontKey: state.frontKey === action.key
    ? windows[windows.length - 1]?.key ?? null : state.frontKey };
}
