// Turns raw Gamepad API snapshots into named digital inputs the binding layer
// can use exactly like key combos:
//
//   Pad.B3        button 3 is down
//   Pad.A1-/A1+   axis 1 pushed past the threshold, either way
//   Pad.HatN/E/S/W  the D-pad when the controller reports it as a "hat" axis
//
// Pure (no browser globals) so it can be tested with made-up snapshots.
//
// Two things about real controllers shaped this, both seen on a Bluetooth Xbox
// pad (045e:0b13) in Chrome, which reports mapping "" rather than "standard":
//   - the D-pad is a hat on axis 9 whose neutral reading is a huge number
//     (1227133568), and its pressed readings are 8 evenly spaced values in
//     -1..1 rather than a normal axis;
//   - the triggers rest at -1, not 0, so an axis has to be judged by how far
//     it has moved from where it rested, not from zero.

export type PadSnapshot = {
  index: number;
  id: string;
  mapping: string;
  buttons: { pressed: boolean; value: number }[];
  axes: number[];
};

export const PAD_PREFIX = "Pad.";
// How far an axis must move from its resting value to count as pressed, and the
// lower bound it must fall back under to count as released (so it can't chatter).
export const AXIS_PRESS = 0.5;
export const AXIS_RELEASE = 0.3;
// Real axis readings are within -1..1; anything far outside is a sentinel.
const AXIS_SANE_LIMIT = 1.5;
const HAT_AXIS = 9;

export const isPadInput = (combo: string) => combo.startsWith(PAD_PREFIX);

const finiteAxis = (value: number) => Number.isFinite(value) && Math.abs(value) <= AXIS_SANE_LIMIT;

// A raw-HID layout puts the D-pad on axis 9 of a 10-axis pad that has no
// standard mapping. (Standard-mapped pads expose the D-pad as buttons 12-15.)
export const hatAxisIndex = (pad: Pick<PadSnapshot, "mapping" | "axes">): number =>
  pad.mapping !== "standard" && pad.axes.length >= 10 ? HAT_AXIS : -1;

// 0 = up, then clockwise in 45 degree steps (1 = up-right ... 7 = up-left), or
// null for neutral / anything that is not one of the 8 positions.
export const decodeHat = (value: number): number | null => {
  if (!finiteAxis(value)) return null;
  const step = Math.round(((value + 1) * 7) / 2);
  if (step < 0 || step > 7) return null;
  const expected = (step * 2) / 7 - 1;
  return Math.abs(expected - value) < 0.08 ? step : null;
};

// Which of the four D-pad directions a hat position is holding down. A diagonal
// holds two.
const HAT_CARDINALS: Record<number, string[]> = {
  0: ["N"], 1: ["N", "E"], 2: ["E"], 3: ["E", "S"], 4: ["S"], 5: ["S", "W"], 6: ["W"], 7: ["N", "W"],
};

export const describeInput = (input: string): string => {
  const id = input.startsWith(PAD_PREFIX) ? input.slice(PAD_PREFIX.length) : input;
  const button = /^B(\d+)$/.exec(id);
  if (button) return `Button ${button[1]}`;
  const axis = /^A(\d+)([+-])$/.exec(id);
  if (axis) return `Axis ${axis[1]} ${axis[2] === "+" ? "+" : "−"}`;
  const hat = /^Hat([NESW])$/.exec(id);
  if (hat) return `D-pad ${{ N: "↑", E: "→", S: "↓", W: "←" }[hat[1] as "N"]}`;
  return input;
};

export const isValidPadInput = (value: string) => /^Pad\.(B\d+|A\d+[+-]|Hat[NESW])$/.test(value);

export class GamepadInputState {
  // Resting axis values per controller, taken from the first reading seen.
  private baselines = new Map<string, number[]>();
  private active = new Set<string>();

  // Forget where the axes rest; the next update takes the present position as
  // the new rest (hands off the sticks).
  recalibrate() {
    this.baselines.clear();
  }

  // The set of inputs held down right now across every connected controller.
  update(pads: PadSnapshot[]): Set<string> {
    const next = new Set<string>();
    const present = new Set<string>();

    for (const pad of pads) {
      const key = `${pad.index}:${pad.id}`;
      present.add(key);
      let baseline = this.baselines.get(key);
      if (!baseline) {
        baseline = pad.axes.map((value) => (finiteAxis(value) ? value : 0));
        this.baselines.set(key, baseline);
      }

      pad.buttons.forEach((button, index) => {
        if (button.pressed || button.value > 0.5) next.add(`${PAD_PREFIX}B${index}`);
      });

      const hat = hatAxisIndex(pad);
      pad.axes.forEach((value, index) => {
        if (index === hat) {
          const position = decodeHat(value);
          if (position !== null) HAT_CARDINALS[position].forEach((c) => next.add(`${PAD_PREFIX}Hat${c}`));
          return;
        }
        if (!finiteAxis(value)) return;
        const delta = value - (baseline![index] ?? 0);
        const plus = `${PAD_PREFIX}A${index}+`;
        const minus = `${PAD_PREFIX}A${index}-`;
        if (delta >= AXIS_PRESS || (this.active.has(plus) && delta >= AXIS_RELEASE)) next.add(plus);
        else if (-delta >= AXIS_PRESS || (this.active.has(minus) && -delta >= AXIS_RELEASE)) next.add(minus);
      });
    }

    for (const key of [...this.baselines.keys()]) {
      if (!present.has(key)) this.baselines.delete(key);
    }
    this.active = next;
    return next;
  }
}
