import { useEffect } from "react";
import { useStore } from "react-redux";
import { isInputCapturing } from "../services/inputCapture";
import { subscribeGamepads } from "../services/gamepadPoller";
import type { RootState } from "../store/store";
import { actionForCombo } from "../utils/keyBindings";
import { getActionRunner } from "./useKeyboardShortcuts";
import { useAppSelector } from "./useAppSelector";

const MODAL_SELECTOR = ".modal.show, [role='dialog'][aria-modal='true']";

// Turns controller buttons, sticks and the D-pad into the same dashboard
// actions the keyboard drives, through the same press/release engine.
//
// Chrome keeps reading a controller while the page is merely visible, even when
// another window has the focus, so without a gate the stick would jog the
// machine while someone works in a different application. Unless the person
// chose otherwise, input is only acted on while this window is focused.
export const useGamepadShortcuts = () => {
  const store = useStore<RootState>();
  const enabled = useAppSelector((state) => state.keyBindings.gamepadEnabled);

  useEffect(() => {
    if (!enabled) return;
    const runner = getActionRunner(store);
    // What is being acted on right now.
    let previous = new Set<string>();
    // Inputs that were already down while input was not allowed (another window
    // had focus, a dialog was open). They must come back up before they count,
    // so a stick still held when the window regains focus does not fire.
    const heldWhileBlocked = new Set<string>();

    const unsubscribe = subscribeGamepads(({ active }) => {
      const state = store.getState();
      const { bindings, gamepadWhenUnfocused } = state.keyBindings;
      const allowed =
        state.ui.activePage === "dashboard" &&
        !isInputCapturing() &&
        document.visibilityState === "visible" &&
        (gamepadWhenUnfocused || document.hasFocus()) &&
        !document.querySelector(MODAL_SELECTOR);

      if (!allowed) {
        // Exactly what is down right now: one that came up while blocked is free
        // to count the next time it goes down.
        heldWhileBlocked.clear();
        active.forEach((input) => heldWhileBlocked.add(input));
        previous.forEach((input) => runner.release(input));
        previous = new Set();
        return;
      }

      heldWhileBlocked.forEach((input) => {
        if (!active.has(input)) heldWhileBlocked.delete(input);
      });
      const now = new Set([...active].filter((input) => !heldWhileBlocked.has(input)));

      for (const input of now) {
        if (previous.has(input)) continue;
        const actionId = actionForCombo(bindings, input);
        if (actionId) runner.press(input, actionId);
      }
      for (const input of previous) {
        if (!now.has(input)) runner.release(input);
      }
      previous = now;
    });

    return () => {
      unsubscribe();
      runner.releaseAll();
    };
  }, [enabled, store]);
};
