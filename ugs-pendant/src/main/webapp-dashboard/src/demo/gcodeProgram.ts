// A small G-code interpreter for the online demo: turns program text into the
// same kind of toolpath segments the real backend serves (so the visualizer and
// simulation work unchanged), plus a per-line command list the simulated
// machine can "run". It understands what typical CAM output uses - G0-G3
// (I/J and R arcs in the XY plane), G4, G17-G21, G53-G59, G90/G91, F, S and
// M3/M4/M5/M7/M8/M9 - and skips anything else. It's a demo aid, not a
// validator.

export type Vec = { x: number; y: number; z: number };

export type Segment = {
  start: Vec;
  end: Vec;
  rapid: boolean;
  arc: boolean;
  // 1-based line of the program text, so it lines up with the editor.
  lineNumber: number;
  feedRate: number;
  inches: boolean;
};

export type ModalField = "distanceMode" | "units" | "plane" | "coordinateSystem";

export type Effect =
  | { kind: "spindle"; mode: "M3" | "M4" | "M5" }
  | { kind: "spindleSpeed"; value: number }
  | { kind: "coolant"; mode: "M7" | "M8" | "M9" }
  | { kind: "modal"; field: ModalField; value: string };

export type Command = {
  line: number;
  segments: Segment[];
  effects: Effect[];
  dwellSeconds: number;
};

export type Program = { commands: Command[]; segments: Segment[] };

export type ParseOptions = {
  // Where the tool is when the program starts (default: the origin).
  start?: Vec;
  // Whether G91 is already in effect.
  relative?: boolean;
};

const WORD = /([A-Za-z])\s*([-+]?(?:\d+\.?\d*|\.\d+))/g;
const FULL_CIRCLE = 2 * Math.PI;
// Arc resolution: segments per full turn.
const ARC_STEPS_PER_TURN = 128;

const arcCenter = (
  start: Vec,
  end: Vec,
  clockwise: boolean,
  i: number | undefined,
  j: number | undefined,
  r: number | undefined
): { x: number; y: number } | null => {
  if (i !== undefined || j !== undefined) return { x: start.x + (i ?? 0), y: start.y + (j ?? 0) };
  if (r === undefined) return null;
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const chord = Math.hypot(dx, dy);
  if (chord === 0) return null;
  const height = Math.sqrt(Math.max(0, r * r - (chord / 2) * (chord / 2)));
  // With a positive R (the minor arc) the center of a clockwise arc is to the
  // right of the chord and a counter-clockwise one's to the left; negative R
  // picks the major arc, the other side.
  const side = (clockwise ? 1 : -1) * (r < 0 ? -1 : 1);
  return {
    x: (start.x + end.x) / 2 + (side * height * dy) / chord,
    y: (start.y + end.y) / 2 - (side * height * dx) / chord,
  };
};

export function parseGcode(text: string, options: ParseOptions = {}): Program {
  const commands: Command[] = [];
  const segments: Segment[] = [];
  const pos: Vec = { ...(options.start ?? { x: 0, y: 0, z: 0 }) };
  let motion = 0;
  let relative = options.relative ?? false;
  let inches = false;
  let plane = 17;
  let feed = 0;

  text.split(/\r?\n/).forEach((raw, index) => {
    const lineNumber = index + 1;
    const line = raw.replace(/\([^)]*\)/g, "").replace(/;.*/, "").trim();
    if (!line || /^[%#$]/.test(line) || /^o\d/i.test(line) || line.includes("[")) return;

    const effects: Effect[] = [];
    const axes: Partial<Record<"X" | "Y" | "Z" | "I" | "J" | "R", number>> = {};
    let dwellSeconds = 0;
    let machineCoords = false;
    let sawDwell = false;

    for (const match of line.matchAll(WORD)) {
      const letter = match[1].toUpperCase();
      const value = parseFloat(match[2]);
      if (letter === "X" || letter === "Y" || letter === "Z" || letter === "I" || letter === "J" || letter === "R") {
        axes[letter] = value;
      } else if (letter === "F") {
        feed = value;
      } else if (letter === "S") {
        effects.push({ kind: "spindleSpeed", value });
      } else if (letter === "P") {
        dwellSeconds = value;
      } else if (letter === "G") {
        const code = Math.round(value * 10) / 10;
        if (code >= 0 && code <= 3) motion = code;
        else if (code === 4) sawDwell = true;
        else if (code === 17 || code === 18 || code === 19) {
          plane = code;
          effects.push({ kind: "modal", field: "plane", value: `G${code}` });
        } else if (code === 20 || code === 21) {
          inches = code === 20;
          effects.push({ kind: "modal", field: "units", value: `G${code}` });
        } else if (code === 53) machineCoords = true;
        else if (code >= 54 && code <= 59) effects.push({ kind: "modal", field: "coordinateSystem", value: `G${code}` });
        else if (code === 90 || code === 91) {
          relative = code === 91;
          effects.push({ kind: "modal", field: "distanceMode", value: `G${code}` });
        }
      } else if (letter === "M") {
        const code = Math.round(value);
        if (code === 3 || code === 4 || code === 5) effects.push({ kind: "spindle", mode: `M${code}` as "M3" | "M4" | "M5" });
        else if (code === 7 || code === 8 || code === 9) effects.push({ kind: "coolant", mode: `M${code}` as "M7" | "M8" | "M9" });
      }
    }

    const cmdSegments: Segment[] = [];
    const hasMove = axes.X !== undefined || axes.Y !== undefined || axes.Z !== undefined;
    if (hasMove && !sawDwell && !machineCoords && motion <= 3) {
      const target: Vec = {
        x: axes.X !== undefined ? (relative ? pos.x + axes.X : axes.X) : pos.x,
        y: axes.Y !== undefined ? (relative ? pos.y + axes.Y : axes.Y) : pos.y,
        z: axes.Z !== undefined ? (relative ? pos.z + axes.Z : axes.Z) : pos.z,
      };
      const make = (start: Vec, end: Vec, arc: boolean): Segment => ({
        start, end, rapid: motion === 0, arc, lineNumber, feedRate: feed, inches,
      });
      const center =
        (motion === 2 || motion === 3) && plane === 17
          ? arcCenter(pos, target, motion === 2, axes.I, axes.J, axes.R)
          : null;
      if (center) {
        const radius = Math.hypot(pos.x - center.x, pos.y - center.y);
        const startAngle = Math.atan2(pos.y - center.y, pos.x - center.x);
        const endAngle = Math.atan2(target.y - center.y, target.x - center.x);
        let delta = endAngle - startAngle;
        if (motion === 2) {
          while (delta >= 0) delta -= FULL_CIRCLE;
        } else {
          while (delta <= 0) delta += FULL_CIRCLE;
        }
        const steps = Math.max(4, Math.ceil((Math.abs(delta) / FULL_CIRCLE) * ARC_STEPS_PER_TURN));
        let previous: Vec = { ...pos };
        for (let s = 1; s <= steps; s++) {
          const angle = startAngle + delta * (s / steps);
          const point: Vec =
            s === steps
              ? { ...target }
              : {
                  x: center.x + radius * Math.cos(angle),
                  y: center.y + radius * Math.sin(angle),
                  z: pos.z + (target.z - pos.z) * (s / steps),
                };
          cmdSegments.push(make(previous, point, true));
          previous = point;
        }
      } else {
        cmdSegments.push(make({ ...pos }, target, false));
      }
      pos.x = target.x;
      pos.y = target.y;
      pos.z = target.z;
    }

    if (cmdSegments.length > 0 || effects.length > 0 || (sawDwell && dwellSeconds > 0)) {
      commands.push({ line: lineNumber, segments: cmdSegments, effects, dwellSeconds: sawDwell ? dwellSeconds : 0 });
      segments.push(...cmdSegments);
    }
  });

  return { commands, segments };
}

// What the toolpath looks like once "run from line" is armed: everything before
// that line is dropped, and a short vertical plunge is put ahead of what's left
// - a rough stand-in for the real backend's clearance-height-then-plunge
// preamble, just enough to see that the run re-approaches from above.
export function toolpathFrom(program: Program, fromLine: number): Segment[] {
  if (fromLine <= 1) return program.segments;
  const remaining = program.segments.filter((segment) => segment.lineNumber >= fromLine);
  if (remaining.length === 0) return remaining;
  const first = remaining[0];
  const plunge: Segment = {
    start: { x: first.start.x, y: first.start.y, z: first.start.z + 10 },
    end: { ...first.start },
    rapid: false,
    arc: false,
    lineNumber: first.lineNumber,
    feedRate: first.feedRate,
    inches: first.inches,
  };
  return [plunge, ...remaining];
}
