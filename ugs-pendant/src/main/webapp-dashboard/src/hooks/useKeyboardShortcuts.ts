import { useEffect } from "react";
import { useStore } from "react-redux";
import { getContinuousJog, onContinuousJogRefused } from "../services/continuousJogSession";
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

// A jog key held at least this long (when "hold to jog" is on) keeps the
// machine moving; released sooner it is one step jog.
export const HOLD_TO_JOG_MS = 250;

type Hold = { command: Extract<ActionCommand, { kind: "jog" }>; started: boolean; timer: number };

const contextOf = (state: RootState) => ({
  connected: state.socket.isConnected,
  state: state.status.state,
  hasFile: state.fileStatus.fileName !== "",
});

// Turns key presses into dashboard actions using the bindings from Settings.
// Reads the store at the moment of the key press rather than closing over
// render-time values, so it never acts on stale state.
export const useKeyboardShortcuts = () => {
  const store = useStore<RootState>();

  useEffect(() => {
    const dispatch = store.dispatch as AppDispatch;
    const continuousJog = getContinuousJog();
    // Jog keys currently down while "hold to jog" is on, by physical key.
    const holds = new Map<string, Hold>();

    const releaseAll = () => {
      holds.forEach((hold) => window.clearTimeout(hold.timer));
      holds.clear();
      continuousJog.stopAll();
    };

    const beginHold = (code: string, command: Hold["command"]) => {
      const existing = holds.get(code);
      if (existing) window.clearTimeout(existing.timer);
      const timer = window.setTimeout(() => {
        const hold = holds.get(code);
        if (!hold) return;
        hold.started = true;
        continuousJog.set(code, { x: command.x, y: command.y, z: command.z });
      }, HOLD_TO_JOG_MS);
      holds.set(code, { command, started: false, timer });
    };

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
      // The OS's key repeat is ignored: holding is handled below as one hold,
      // not as a stream of presses that would queue a jog per repeat.
      if (event.repeat) return;

      const command = commandFor(actionId);
      if (!command) return;
      if (!isCommandAvailable(command, contextOf(state))) return;

      if (command.kind === "jog" && state.keyBindings.holdToJog) {
        beginHold(event.code, command);
        return;
      }
      runActionCommand(command, state, dispatch);
    };

    // Releasing is handled regardless of the settings or focus, so a jog can
    // never be left running because the key came up somewhere unexpected.
    const onKeyUp = (event: KeyboardEvent) => {
      const hold = holds.get(event.code);
      if (!hold) return;
      holds.delete(event.code);
      window.clearTimeout(hold.timer);
      if (hold.started) {
        continuousJog.set(event.code, null);
        return;
      }
      // Let go before the hold threshold: an ordinary step jog.
      const state = store.getState();
      if (isCommandAvailable(hold.command, contextOf(state))) {
        runActionCommand(hold.command, state, dispatch);
      }
    };

    // Anything that takes the keyboard away from the page must stop a jog: a
    // key-up will never arrive.
    const onVisibility = () => {
      if (document.visibilityState === "hidden") releaseAll();
    };

    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    window.addEventListener("blur", releaseAll);
    window.addEventListener("pagehide", releaseAll);
    document.addEventListener("visibilitychange", onVisibility);
    // The backend declined (job started, alarm, disconnect): forget the holds.
    const stopRefusedListener = onContinuousJogRefused(() => {
      holds.forEach((hold) => window.clearTimeout(hold.timer));
      holds.clear();
    });

    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      window.removeEventListener("blur", releaseAll);
      window.removeEventListener("pagehide", releaseAll);
      document.removeEventListener("visibilitychange", onVisibility);
      stopRefusedListener();
      releaseAll();
    };
  }, [store]);
};
