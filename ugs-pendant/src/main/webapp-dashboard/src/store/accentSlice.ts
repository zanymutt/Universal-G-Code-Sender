import { createSlice, PayloadAction } from "@reduxjs/toolkit";
import { AccentPreset, isAccentPreset } from "../theme/accentPresets";

const STORAGE_KEY = "ugs-dashboard-accent";

const getInitialAccent = (): AccentPreset => {
  if (typeof window === "undefined") return "green";
  const saved = window.localStorage.getItem(STORAGE_KEY);
  return isAccentPreset(saved) ? saved : "green";
};

type AccentState = {
  accent: AccentPreset;
};

const accentSlice = createSlice({
  name: "accent",
  initialState: { accent: getInitialAccent() } as AccentState,
  reducers: {
    setAccent: (state, action: PayloadAction<AccentPreset>) => {
      state.accent = action.payload;
      if (typeof window !== "undefined") {
        window.localStorage.setItem(STORAGE_KEY, action.payload);
      }
    },
  },
});

export const accentActions = accentSlice.actions;
export default accentSlice.reducer;
