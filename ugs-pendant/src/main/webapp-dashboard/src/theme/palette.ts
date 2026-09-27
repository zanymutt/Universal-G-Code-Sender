import { AccentPreset, ACCENT_PRESETS } from "./accentPresets";
import { DashboardTheme } from "../store/themeSlice";

// The base (non-accent) tokens from theme.scss's :root / :root[data-theme="light"]
// blocks, duplicated here as plain data so the plugin bridge (see
// PluginWindow.tsx's "getTheme" method/'theme' event) can hand a plugin a
// snapshot without reading getComputedStyle - which would race App.tsx's own
// effect that writes the live custom properties when the theme/accent redux
// state changes in the same commit. Keep these in sync with theme.scss if
// the base palette ever changes.
const BASE_PALETTE: Record<
  DashboardTheme,
  {
    background: string;
    surface: string;
    surfaceRaised: string;
    border: string;
    borderStrong: string;
    text: string;
    textMuted: string;
  }
> = {
  dark: {
    background: "#1c1e1f",
    surface: "#111213",
    surfaceRaised: "#2a2c2d",
    border: "#2f3132",
    borderStrong: "#3a3d3e",
    text: "#e5e7eb",
    textMuted: "#c3c8cb",
  },
  light: {
    background: "#eef1f4",
    surface: "#ffffff",
    surfaceRaised: "#ffffff",
    border: "#dde2e7",
    borderStrong: "#c7ced6",
    text: "#1b2027",
    textMuted: "#4d5761",
  },
};

export type PluginThemeSnapshot = {
  mode: DashboardTheme;
  colors: {
    background: string;
    surface: string;
    surfaceRaised: string;
    border: string;
    // A more visible border than `border` - matches the dashboard's own
    // two-tier convention (interactive controls like buttons/inputs use
    // this one; ambient panel/card dividers use the softer `border`).
    borderStrong: string;
    text: string;
    textMuted: string;
    accent: string;
  };
};

export const getPluginThemeSnapshot = (mode: DashboardTheme, accent: AccentPreset): PluginThemeSnapshot => ({
  mode,
  colors: {
    ...BASE_PALETTE[mode],
    accent: ACCENT_PRESETS[accent][mode].accent,
  },
});
