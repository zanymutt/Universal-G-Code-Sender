// Accent color presets - each preset picks one hue, but (like the base
// light/dark tokens in theme.scss) needs a different lightness/saturation
// per theme: a vivid tone that pops on the dark surfaces, and a darker,
// more saturated tone that stays readable on the light theme's near-white
// surfaces. Applied by setting these as inline custom properties on
// <html> (see App.tsx), which override theme.scss's own --dashboard-accent*
// defaults regardless of which theme is active.
export type AccentPreset = "green" | "blue" | "orange" | "purple" | "teal";

export type AccentTokens = {
  accent: string;
  soft: string;
  border: string;
};

export const ACCENT_PRESET_ORDER: AccentPreset[] = ["green", "blue", "orange", "purple", "teal"];

export const ACCENT_PRESETS: Record<AccentPreset, { label: string; dark: AccentTokens; light: AccentTokens }> = {
  green: {
    label: "Green",
    dark: { accent: "#4ade80", soft: "rgba(74, 222, 128, 0.14)", border: "#2d5a3f" },
    light: { accent: "#0f8a4c", soft: "rgba(15, 138, 76, 0.1)", border: "#a3d9bb" },
  },
  blue: {
    label: "Blue",
    dark: { accent: "#4f9eff", soft: "rgba(79, 158, 255, 0.14)", border: "#294a73" },
    light: { accent: "#1c6fd6", soft: "rgba(28, 111, 214, 0.1)", border: "#aecbf0" },
  },
  orange: {
    label: "Orange",
    dark: { accent: "#fb923c", soft: "rgba(251, 146, 60, 0.14)", border: "#6b3d1a" },
    light: { accent: "#b2540a", soft: "rgba(178, 84, 10, 0.1)", border: "#f0cba3" },
  },
  purple: {
    label: "Purple",
    dark: { accent: "#c084fc", soft: "rgba(192, 132, 252, 0.14)", border: "#4a3266" },
    light: { accent: "#7c3aed", soft: "rgba(124, 58, 237, 0.1)", border: "#d8c6f7" },
  },
  teal: {
    label: "Teal",
    dark: { accent: "#2dd4bf", soft: "rgba(45, 212, 191, 0.14)", border: "#164e46" },
    light: { accent: "#0f766e", soft: "rgba(15, 118, 110, 0.1)", border: "#a8ded8" },
  },
};

export const isAccentPreset = (value: string | null): value is AccentPreset =>
  !!value && Object.prototype.hasOwnProperty.call(ACCENT_PRESETS, value);
