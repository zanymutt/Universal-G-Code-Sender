import { createSlice, PayloadAction } from "@reduxjs/toolkit";

export type DashboardTheme = "dark" | "light";

const STORAGE_KEY = "ugs-dashboard-theme";

const getInitialTheme = (): DashboardTheme => {
  if (typeof window === "undefined") return "dark";
  const saved = window.localStorage.getItem(STORAGE_KEY);
  return saved === "light" ? "light" : "dark";
};

type ThemeState = {
  theme: DashboardTheme;
};

const themeSlice = createSlice({
  name: "theme",
  initialState: { theme: getInitialTheme() } as ThemeState,
  reducers: {
    setTheme: (state, action: PayloadAction<DashboardTheme>) => {
      state.theme = action.payload;
      if (typeof window !== "undefined") {
        window.localStorage.setItem(STORAGE_KEY, action.payload);
      }
    },
  },
});

export const themeActions = themeSlice.actions;
export default themeSlice.reducer;
