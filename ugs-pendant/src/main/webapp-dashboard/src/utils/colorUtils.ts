// Color math for the dashboard's own color picker (components/ColorPicker.tsx). Pure, so it is
// unit-tested in node (tests/colorUtils.test.cjs). Colors are "#rrggbb" strings outside this file and
// HSV (hue 0-360, saturation and value 0-1) inside the picker, where dragging a square and a slider
// is natural.

export type Hsv = { h: number; s: number; v: number };

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

// "#abc", "abc", "#aabbcc" or "AABBCC" as a lowercase "#rrggbb", or null when it isn't a color.
export const normalizeHex = (text: string): string | null => {
  const match = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(text.trim());
  if (!match) return null;
  const digits = match[1].length === 3 ? match[1].replace(/./g, (c) => c + c) : match[1];
  return `#${digits.toLowerCase()}`;
};

export const hexToRgb = (hex: string): [number, number, number] => {
  const normal = normalizeHex(hex) ?? "#000000";
  return [1, 3, 5].map((i) => parseInt(normal.slice(i, i + 2), 16)) as [number, number, number];
};

export const rgbToHex = (r: number, g: number, b: number): string =>
  "#" +
  [r, g, b]
    .map((channel) => Math.round(clamp(channel, 0, 255)).toString(16).padStart(2, "0"))
    .join("");

export const rgbToHsv = (r: number, g: number, b: number): Hsv => {
  const red = r / 255;
  const green = g / 255;
  const blue = b / 255;
  const max = Math.max(red, green, blue);
  const delta = max - Math.min(red, green, blue);
  let h = 0;
  if (delta > 0) {
    if (max === red) h = ((green - blue) / delta) % 6;
    else if (max === green) h = (blue - red) / delta + 2;
    else h = (red - green) / delta + 4;
    h *= 60;
    if (h < 0) h += 360;
  }
  return { h, s: max === 0 ? 0 : delta / max, v: max };
};

export const hsvToRgb = ({ h, s, v }: Hsv): [number, number, number] => {
  const hue = ((h % 360) + 360) % 360;
  const chroma = v * s;
  const x = chroma * (1 - Math.abs(((hue / 60) % 2) - 1));
  const m = v - chroma;
  const [r, g, b] =
    hue < 60 ? [chroma, x, 0] : hue < 120 ? [x, chroma, 0] : hue < 180 ? [0, chroma, x] : hue < 240 ? [0, x, chroma] : hue < 300 ? [x, 0, chroma] : [chroma, 0, x];
  return [(r + m) * 255, (g + m) * 255, (b + m) * 255];
};

export const hexToHsv = (hex: string): Hsv => rgbToHsv(...hexToRgb(hex));

export const hsvToHex = (hsv: Hsv): string => rgbToHex(...hsvToRgb(hsv));

// The fully saturated color of a hue, for the square's background.
export const hueColor = (h: number): string => hsvToHex({ h, s: 1, v: 1 });

// Where in a box (any size, in the same units as the box) a pointer is, as 0-1 fractions clamped to it.
// Works at any page zoom because both the box and the pointer are in screen coordinates.
export const fractionInBox = (
  pointerX: number,
  pointerY: number,
  box: { left: number; top: number; width: number; height: number }
): { x: number; y: number } => ({
  x: box.width > 0 ? clamp((pointerX - box.left) / box.width, 0, 1) : 0,
  y: box.height > 0 ? clamp((pointerY - box.top) / box.height, 0, 1) : 0,
});
