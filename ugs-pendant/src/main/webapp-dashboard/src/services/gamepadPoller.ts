import { GamepadInputState, PadSnapshot } from "../utils/gamepadInput";

// One shared read loop over navigator.getGamepads() for everything that needs
// controller input (the dashboard's shortcuts, the settings page's live view and
// press-to-bind). It runs only while something is subscribed, and owns the
// resting-position and hysteresis state so every subscriber sees the same inputs.

export type GamepadFrame = {
  pads: PadSnapshot[];
  // Inputs held down right now ("Pad.B3", "Pad.A1-", "Pad.HatN").
  active: Set<string>;
};

type Listener = (frame: GamepadFrame) => void;

const state = new GamepadInputState();
const listeners = new Set<Listener>();
// ~60 Hz. A timer rather than requestAnimationFrame: the dashboard only acts on a
// controller while the page is visible anyway, and a timer does not stall when a
// window is visible but the browser isn't painting it.
const POLL_MS = 16;
let handle: number | null = null;

export const hasGamepadApi = () => typeof navigator !== "undefined" && typeof navigator.getGamepads === "function";

const readPads = (): PadSnapshot[] => {
  if (!hasGamepadApi()) return [];
  const pads: PadSnapshot[] = [];
  for (const pad of navigator.getGamepads()) {
    if (!pad || !pad.connected) continue;
    pads.push({
      index: pad.index,
      id: pad.id,
      mapping: pad.mapping,
      buttons: pad.buttons.map((button) => ({ pressed: button.pressed, value: button.value })),
      axes: [...pad.axes],
    });
  }
  return pads;
};

const poll = () => {
  const pads = readPads();
  const frame: GamepadFrame = { pads, active: state.update(pads) };
  listeners.forEach((listener) => listener(frame));
};

export const subscribeGamepads = (listener: Listener): (() => void) => {
  listeners.add(listener);
  if (listeners.size === 1) handle = window.setInterval(poll, POLL_MS);
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0 && handle !== null) {
      window.clearInterval(handle);
      handle = null;
    }
  };
};

// Take the sticks' and triggers' present positions as their rest positions.
export const recalibrateGamepads = () => state.recalibrate();
