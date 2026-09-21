import heart from "./samples/heart.gcode?raw";
import arcsAndSlot from "./samples/arcs-and-slot.nc?raw";

// A rectangular pocket cut as concentric passes, three levels deep. Generated
// rather than stored: it's a long, regular program that's tedious to write out.
const spiralPocket = (): string => {
  const width = 60;
  const height = 40;
  const stepover = 4;
  const lines = [
    "(UGS Dashboard demo: 60 x 40 mm pocket, three depth passes)",
    "(Units = mm)",
    "G21 G90 G17 G54",
    "M3 S10000",
    "G0 Z5",
  ];
  for (let level = 1; level <= 3; level++) {
    lines.push(`(--- depth pass ${level}: Z-${level} ---)`);
    lines.push(`G0 X0 Y0`);
    lines.push(`G1 Z-${level} F250`);
    for (let inset = 0; inset * 2 < Math.min(width, height) - 1; inset += stepover) {
      const x0 = inset;
      const y0 = inset;
      const x1 = width - inset;
      const y1 = height - inset;
      lines.push(`G1 X${x0} Y${y0} F800`);
      lines.push(`G1 X${x1} Y${y0}`);
      lines.push(`G1 X${x1} Y${y1}`);
      lines.push(`G1 X${x0} Y${y1}`);
      lines.push(`G1 X${x0} Y${y0 + stepover}`);
    }
    lines.push("G0 Z5");
  }
  lines.push("M5", "G0 X0 Y0", "M30");
  return lines.join("\n") + "\n";
};

// The workspace the demo starts with: workspace-relative, "/"-separated paths.
export const SAMPLE_FILES: Record<string, string> = {
  "heart.gcode": heart,
  "arcs-and-slot.nc": arcsAndSlot,
  "Examples/spiral-pocket.nc": spiralPocket(),
};

export const DEFAULT_FILE = "heart.gcode";
