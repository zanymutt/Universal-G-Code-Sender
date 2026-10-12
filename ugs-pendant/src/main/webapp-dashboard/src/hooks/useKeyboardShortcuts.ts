import { useEffect } from "react";
import { useStore } from "react-redux";
import { runMacro } from "../services/macros";
import { pause, stop } from "../services/files";
import { homeMachine, jog, killAlarm, resetToZero, returnToZero, sendOverride, softReset } from "../services/machine";
import type { OverrideCommand } from "../services/machine";
import { setSettings } from "../store/settingsSlice";
import type { AppDispatch, RootState } from "../store/store";
import {
  actionForCombo,
  comboFromEvent,
  isActivationOnControl,
  isTypingTarget,
} from "../utils/keyBindings";
import { ActionCommand, commandFor, isCommandAvailable } from "../utils/dashboardActions";
import { FEED_RATE_OPTIONS, STEP_SIZE_OPTIONS, stepPreset } from "../utils/jogPresets";

// Window event JobBar listens for, so Start goes through the same "unsaved
// editor text" warning as clicking the button.
export const JOB_START_EVENT = "ugs-job-start";

const MODAL_SELECTOR = ".modal.show, [role='dialog'][aria-modal='true']";

const quiet = (promise: Promise<unknown> | undefined) => {
  promise?.catch((error) => console.warn("Keyboard shortcut failed", error));
};

// Carries out a command. Callers check isCommandAvailable first.
export const runActionCommand = (command: ActionCommand, state: RootState, dispatch: AppDispatch) => {
  switch (command.kind) {
    case "jog":
      quiet(jog(command.x, command.y, command.z));
      return;
    case "step": {
      const { settings } = state;
      if (command.axis === "xy") {
        const next = stepPreset(STEP_SIZE_OPTIONS, settings.jogStepSizeXY, command.dir);
        dispatch(setSettings({ ...settings, jogStepSizeXY: next }));
      } else if (settings.useZStepSize) {
        const next = stepPreset(STEP_SIZE_OPTIONS, settings.jogStepSizeZ, command.dir);
        dispatch(setSettings({ ...settings, jogStepSizeZ: next }));
      }
      return;
    }
    case "feed": {
      const { settings } = state;
      const next = stepPreset(FEED_RATE_OPTIONS, settings.jogFeedRate, command.dir);
      dispatch(setSettings({ ...settings, jogFeedRate: next }));
      return;
    }
    case "override":
      quiet(sendOverride(command.command as OverrideCommand));
      return;
    case "job":
      if (command.op === "start") window.dispatchEvent(new CustomEvent(JOB_START_EVENT));
      else if (command.op === "pause") quiet(pause());
      else quiet(stop());
      return;
    case "zero":
      quiet(resetToZero(command.axis));
      return;
    case "machine":
      if (command.op === "home") quiet(homeMachine());
      else if (command.op === "returnToZero") quiet(returnToZero());
      else if (command.op === "unlock") quiet(killAlarm());
      else quiet(softReset());
      return;
    case "macro": {
      const macro = state.macros.macros.find((candidate) => candidate.uuid === command.uuid);
      if (macro) quiet(runMacro(macro));
      return;
    }
  }
};

// Turns key presses into dashboard actions using the bindings from Settings.
// Reads the store at the moment of the key press rather than closing over
// render-time values, so it never acts on stale state.
export const useKeyboardShortcuts = () => {
  const store = useStore<RootState>();

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const state = store.getState();
      if (!state.keyBindings.enabled) return;
      if (state.ui.activePage !== "dashboard") return;
      if (event.defaultPrevented || event.isComposing) return;

      const combo = comboFromEvent(event);
      if (!combo) return;
      const actionId = actionForCombo(state.keyBindings.bindings, combo);
      if (!actionId) return;

      const target = event.target as HTMLElement | null;
      if (isTypingTarget(target) || isActivationOnControl(event.code, target)) return;
      if (document.querySelector(MODAL_SELECTOR)) return;

      // A bound key never also scrolls the page or moves a focused radio group.
      event.preventDefault();
      // Holding a key does not repeat: a queued jog keeps running after the key
      // is released. (Held-key continuous jog is a separate, backend-side piece.)
      if (event.repeat) return;

      const command = commandFor(actionId);
      if (!command) return;
      const ctx = {
        connected: state.socket.isConnected,
        state: state.status.state,
        hasFile: state.fileStatus.fileName !== "",
      };
      if (!isCommandAvailable(command, ctx)) return;
      runActionCommand(command, state, store.dispatch as AppDispatch);
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [store]);
};
