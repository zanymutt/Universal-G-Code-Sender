import { createSlice, PayloadAction } from "@reduxjs/toolkit";
import {
  assignCombo,
  defaultKeyBindingSettings,
  KEY_BINDINGS_STORAGE_KEY,
  KeyBindingSettings,
  removeCombo,
  sanitizeKeyBindingSettings,
} from "../utils/keyBindings";

// Per browser/device on purpose: which keys exist (a numeric keypad, a Bluetooth
// pad) is a property of the device in front of the person, not of the machine.
const readStored = (): KeyBindingSettings => {
  try {
    const stored = window.localStorage.getItem(KEY_BINDINGS_STORAGE_KEY);
    return stored ? sanitizeKeyBindingSettings(JSON.parse(stored)) : defaultKeyBindingSettings();
  } catch {
    return defaultKeyBindingSettings();
  }
};

const persist = (settings: KeyBindingSettings) => {
  try {
    window.localStorage.setItem(KEY_BINDINGS_STORAGE_KEY, JSON.stringify(settings));
  } catch {
    // Not persisting is fine - it falls back to the defaults next time.
  }
};

const keyBindingsSlice = createSlice({
  name: "keyBindings",
  initialState: readStored(),
  reducers: {
    setEnabled: (state, action: PayloadAction<boolean>) => {
      state.enabled = action.payload;
      persist(state);
    },
    setHoldToJog: (state, action: PayloadAction<boolean>) => {
      state.holdToJog = action.payload;
      persist(state);
    },
    assign: (state, action: PayloadAction<{ actionId: string; combo: string }>) => {
      state.bindings = assignCombo(state.bindings, action.payload.actionId, action.payload.combo).bindings;
      persist(state);
    },
    remove: (state, action: PayloadAction<{ actionId: string; combo: string }>) => {
      state.bindings = removeCombo(state.bindings, action.payload.actionId, action.payload.combo);
      persist(state);
    },
    // Back to the shipped keys. Whether shortcuts are enabled is left alone.
    resetBindings: (state) => {
      state.bindings = defaultKeyBindingSettings().bindings;
      persist(state);
    },
  },
});

export const keyBindingsActions = keyBindingsSlice.actions;
export default keyBindingsSlice.reducer;
