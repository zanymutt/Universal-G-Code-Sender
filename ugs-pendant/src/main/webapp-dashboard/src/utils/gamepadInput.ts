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
// How far an axis must move from its resting value to count as pressed (the
// activation point), and how close to rest it must come back to count as
// released again (the dead band, so it can't chatter around the activation
// point). Both are fractions of full travel and are the person's to tune.
export type PadTuning = { activation: number; deadband: number };

export const DEFAULT_PAD_TUNING: PadTuning = { activation: 0.5, deadband: 0.3 };
export const ACTIVATION_RANGE = { min: 0.2, max: 0.9 };
export const DEADBAND_RANGE = { min: 0.05, max: 0.6 };
// The release point always sits at least this far inside the activation point.
const MIN_HYSTERESIS = 0.05;

const clampTo = (value: unknown, range: { min: number; max: number }, fallback: number) =>
  typeof value === "number" && Number.isFinite(value) ? Math.min(range.max, Math.max(range.min, value)) : fallback;

export const sanitizePadTuning = (raw: Partial<PadTuning> | null | undefined): PadTuning => ({
  activation: clampTo(raw?.activation, ACTIVATION_RANGE, DEFAULT_PAD_TUNING.activation),
  deadband: clampTo(raw?.deadband, DEADBAND_RANGE, DEFAULT_PAD_TUNING.deadband),
});

// Where an axis counts as pressed and where it counts as released again.
export const axisThresholds = (tuning: PadTuning) => {
  const press = tuning.activation;
  return { press, release: Math.max(0.02, Math.min(tuning.deadband, press - MIN_HYSTERESIS)) };
};
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

// Names for the standard mapping's buttons and axes (Xbox-style labels), shown
// beside the numbers so a layout can be read at a glance. Only meaningful when
// the controller reports mapping "standard".
export const STANDARD_BUTTON_NAMES = [
  "A", "B", "X", "Y", "LB", "RB", "LT", "RT", "View", "Menu", "L stick", "R stick",
  "D-pad ↑", "D-pad ↓", "D-pad ←", "D-pad →", "Guide",
];
export const STANDARD_AXIS_NAMES = ["Left stick X", "Left stick Y", "Right stick X", "Right stick Y"];

export const buttonName = (mapping: string, index: number): string | null =>
  mapping === "standard" ? STANDARD_BUTTON_NAMES[index] ?? null : null;
export const axisName = (mapping: string, index: number): string | null =>
  mapping === "standard" ? STANDARD_AXIS_NAMES[index] ?? null : null;

// "up", "up-right", ... for a decoded hat position (0 = up, clockwise).
export const HAT_POSITION_NAMES = ["up", "up-right", "right", "down-right", "down", "down-left", "left", "up-left"];

export const isValidPadInput = (value: string) => /^Pad\.(B\d+|A\d+[+-]|Hat[NESW])$/.test(value);

export class GamepadInputState {
  // Resting axis values per controller, taken from the first reading seen.
  private baselines = new Map<string, number[]>();
  private active = new Set<string>();
  private tuning: PadTuning = DEFAULT_PAD_TUNING;
  // How far each axis of each controller is from its rest, by the same order
  // as the `pads` last given to update() (for showing the person what they do).
  private deltas: number[][] = [];

  setTuning(tuning: PadTuning) {
    this.tuning = sanitizePadTuning(tuning);
  }

  // Axis movement from rest for each controller in the last update(); a hat or
  // an unusable reading is 0.
  axisDeltas(): number[][] {
    return this.deltas;
  }

  // Forget where the axes rest; the next update takes the present position as
  // the new rest (hands off the sticks).
  recalibrate() {
    this.baselines.clear();
  }

  // The set of inputs held down right now across every connected controller.
  update(pads: PadSnapshot[]): Set<string> {
    const next = new Set<string>();
    const present = new Set<string>();
    const { press, release } = axisThresholds(this.tuning);
    const deltas: number[][] = [];

    for (const pad of pads) {
      const key = `${pad.index}:${pad.id}`;
      present.add(key);
      let baseline = this.baselines.get(key);
      if (!baseline) {
        baseline = pad.axes.map((value) => (finiteAxis(value) ? value : 0));
        this.baselines.set(key, baseline);
      }

      // A button can be analog (the triggers of a standard-mapped pad report
      // partial pressure in `value`), so it is judged like an axis: pressed at
      // the activation point, held until it falls back under the dead band. A
      // plain digital button reports 0 or 1 and so is unaffected; one that
      // reports only `pressed` counts as fully down.
      pad.buttons.forEach((button, index) => {
        const value = button.value > 0 ? button.value : button.pressed ? 1 : 0;
        const id = `${PAD_PREFIX}B${index}`;
        if (value >= press || (this.active.has(id) && value >= release)) next.add(id);
      });

      const hat = hatAxisIndex(pad);
      const padDeltas: number[] = [];
      pad.axes.forEach((value, index) => {
        padDeltas[index] = 0;
        if (index === hat) {
          const position = decodeHat(value);
          if (position !== null) HAT_CARDINALS[position].forEach((c) => next.add(`${PAD_PREFIX}Hat${c}`));
          return;
        }
        if (!finiteAxis(value)) return;
        const delta = value - (baseline![index] ?? 0);
        padDeltas[index] = delta;
        const plus = `${PAD_PREFIX}A${index}+`;
        const minus = `${PAD_PREFIX}A${index}-`;
        if (delta >= press || (this.active.has(plus) && delta >= release)) next.add(plus);
        else if (-delta >= press || (this.active.has(minus) && -delta >= release)) next.add(minus);
      });
      deltas.push(padDeltas);
    }
    this.deltas = deltas;

    for (const key of [...this.baselines.keys()]) {
      if (!present.has(key)) this.baselines.delete(key);
    }
    this.active = next;
    return next;
  }
}
