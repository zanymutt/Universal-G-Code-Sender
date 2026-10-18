import { createSlice, PayloadAction } from "@reduxjs/toolkit";
import { JogPresets, JogPresetKind, normalizeJogPresets } from "../utils/jogPresets";

const STORAGE_KEY = "ugs-dashboard-jog-presets";

const load = (): JogPresets => {
  try {
    const saved = window.localStorage.getItem(STORAGE_KEY);
    if (saved) return normalizeJogPresets(JSON.parse(saved));
  } catch {
    // Unreadable or blocked storage: use the defaults.
  }
  return normalizeJogPresets(null);
};

const save = (presets: JogPresets) => {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(presets));
  } catch {
    // Not remembering the values is fine.
  }
};

const jogPresetsSlice = createSlice({
  name: "jogPresets",
  initialState: load(),
  reducers: {
    // Replaces one slot of one row. Callers validate the value first.
    setPreset: (state, action: PayloadAction<{ kind: JogPresetKind; index: number; value: number }>) => {
      const { kind, index, value } = action.payload;
      if (index < 0 || index >= state[kind].length) return;
      state[kind][index] = value;
      save(state);
    },
    reset: () => {
      const defaults = normalizeJogPresets(null);
      save(defaults);
      return defaults;
    },
  },
});

export const jogPresetsActions = jogPresetsSlice.actions;
export default jogPresetsSlice.reducer;
