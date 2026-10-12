// The named things an input device (keyboard now, gamepad later) can ask the
// dashboard to do. Everything here is pure data: what an action IS
// (`commandFor`) and whether the machine is in a state where it may run
// (`isCommandAvailable`). Executing a command is the hook's job, so a second
// input source reuses all of this unchanged.
//
// The availability rules deliberately mirror the on-screen controls (JogPad,
// JobBar, Toolbox, AxisRow, OverrideControls, MacrosPanel) so a key can never
// do something its button would have been disabled for.

export type ActionGroup = "Jog" | "Jog settings" | "Job" | "Machine" | "Overrides";

type Dir = -1 | 0 | 1;

export type ActionCommand =
  | { kind: "jog"; x: Dir; y: Dir; z: Dir }
  | { kind: "step"; axis: "xy" | "z"; dir: 1 | -1 }
  | { kind: "feed"; dir: 1 | -1 }
  | { kind: "override"; command: string }
  | { kind: "job"; op: "start" | "pause" | "stop" }
  | { kind: "machine"; op: "home" | "returnToZero" | "unlock" | "softReset" }
  | { kind: "zero"; axis?: "X" | "Y" | "Z" }
  | { kind: "macro"; uuid: string };

export type ActionDef = {
  id: string;
  label: string;
  group: ActionGroup;
  command: ActionCommand;
  // Combos bound the first time (or after "Reset to defaults"). Anything that
  // starts or stops a job, or moves the machine without a direction held, is
  // left unbound on purpose - nothing should happen by accident.
  defaults: string[];
};

const jogDef = (id: string, label: string, x: Dir, y: Dir, z: Dir, defaults: string[]): ActionDef => ({
  id,
  label,
  group: "Jog",
  command: { kind: "jog", x, y, z },
  defaults,
});

export const ACTIONS: ActionDef[] = [
  jogDef("jog.xMinus", "Jog X-", -1, 0, 0, ["ArrowLeft", "Numpad4"]),
  jogDef("jog.xPlus", "Jog X+", 1, 0, 0, ["ArrowRight", "Numpad6"]),
  jogDef("jog.yPlus", "Jog Y+", 0, 1, 0, ["ArrowUp", "Numpad8"]),
  jogDef("jog.yMinus", "Jog Y-", 0, -1, 0, ["ArrowDown", "Numpad2"]),
  jogDef("jog.zPlus", "Jog Z+", 0, 0, 1, ["PageUp", "NumpadAdd"]),
  jogDef("jog.zMinus", "Jog Z-", 0, 0, -1, ["PageDown", "NumpadSubtract"]),
  jogDef("jog.xMinusYPlus", "Jog X- Y+", -1, 1, 0, ["Numpad7"]),
  jogDef("jog.xPlusYPlus", "Jog X+ Y+", 1, 1, 0, ["Numpad9"]),
  jogDef("jog.xMinusYMinus", "Jog X- Y-", -1, -1, 0, ["Numpad1"]),
  jogDef("jog.xPlusYMinus", "Jog X+ Y-", 1, -1, 0, ["Numpad3"]),

  { id: "step.xyUp", label: "X/Y step larger", group: "Jog settings", command: { kind: "step", axis: "xy", dir: 1 }, defaults: ["BracketRight"] },
  { id: "step.xyDown", label: "X/Y step smaller", group: "Jog settings", command: { kind: "step", axis: "xy", dir: -1 }, defaults: ["BracketLeft"] },
  { id: "step.zUp", label: "Z step larger", group: "Jog settings", command: { kind: "step", axis: "z", dir: 1 }, defaults: [] },
  { id: "step.zDown", label: "Z step smaller", group: "Jog settings", command: { kind: "step", axis: "z", dir: -1 }, defaults: [] },
  { id: "feed.up", label: "Jog feed rate faster", group: "Jog settings", command: { kind: "feed", dir: 1 }, defaults: ["NumpadMultiply"] },
  { id: "feed.down", label: "Jog feed rate slower", group: "Jog settings", command: { kind: "feed", dir: -1 }, defaults: ["NumpadDivide"] },

  { id: "job.start", label: "Start / resume", group: "Job", command: { kind: "job", op: "start" }, defaults: [] },
  { id: "job.pause", label: "Pause", group: "Job", command: { kind: "job", op: "pause" }, defaults: [] },
  { id: "job.stop", label: "Stop", group: "Job", command: { kind: "job", op: "stop" }, defaults: [] },

  { id: "machine.zeroAll", label: "Reset zero (all axes)", group: "Machine", command: { kind: "zero" }, defaults: [] },
  { id: "machine.zeroX", label: "Reset zero X", group: "Machine", command: { kind: "zero", axis: "X" }, defaults: [] },
  { id: "machine.zeroY", label: "Reset zero Y", group: "Machine", command: { kind: "zero", axis: "Y" }, defaults: [] },
  { id: "machine.zeroZ", label: "Reset zero Z", group: "Machine", command: { kind: "zero", axis: "Z" }, defaults: [] },
  { id: "machine.returnToZero", label: "Return to zero", group: "Machine", command: { kind: "machine", op: "returnToZero" }, defaults: [] },
  { id: "machine.home", label: "Home machine", group: "Machine", command: { kind: "machine", op: "home" }, defaults: [] },
  { id: "machine.unlock", label: "Unlock (kill alarm)", group: "Machine", command: { kind: "machine", op: "unlock" }, defaults: [] },
  { id: "machine.softReset", label: "Soft reset", group: "Machine", command: { kind: "machine", op: "softReset" }, defaults: [] },

  { id: "override.feedPlus", label: "Feed +10%", group: "Overrides", command: { kind: "override", command: "CMD_FEED_OVR_COARSE_PLUS" }, defaults: [] },
  { id: "override.feedMinus", label: "Feed -10%", group: "Overrides", command: { kind: "override", command: "CMD_FEED_OVR_COARSE_MINUS" }, defaults: [] },
  { id: "override.feedReset", label: "Feed reset", group: "Overrides", command: { kind: "override", command: "CMD_FEED_OVR_RESET" }, defaults: [] },
  { id: "override.rapidLow", label: "Rapid 25%", group: "Overrides", command: { kind: "override", command: "CMD_RAPID_OVR_LOW" }, defaults: [] },
  { id: "override.rapidMedium", label: "Rapid 50%", group: "Overrides", command: { kind: "override", command: "CMD_RAPID_OVR_MEDIUM" }, defaults: [] },
  { id: "override.rapidReset", label: "Rapid 100%", group: "Overrides", command: { kind: "override", command: "CMD_RAPID_OVR_RESET" }, defaults: [] },
  { id: "override.spindlePlus", label: "Spindle +10%", group: "Overrides", command: { kind: "override", command: "CMD_SPINDLE_OVR_COARSE_PLUS" }, defaults: [] },
  { id: "override.spindleMinus", label: "Spindle -10%", group: "Overrides", command: { kind: "override", command: "CMD_SPINDLE_OVR_COARSE_MINUS" }, defaults: [] },
  { id: "override.spindleReset", label: "Spindle reset", group: "Overrides", command: { kind: "override", command: "CMD_SPINDLE_OVR_RESET" }, defaults: [] },
];

export const ACTION_GROUPS: ActionGroup[] = ["Jog", "Jog settings", "Job", "Machine", "Overrides"];

export const MACRO_ACTION_PREFIX = "macro:";
export const macroActionId = (uuid: string) => `${MACRO_ACTION_PREFIX}${uuid}`;
export const isMacroActionId = (id: string) => id.startsWith(MACRO_ACTION_PREFIX);

const ACTIONS_BY_ID = new Map(ACTIONS.map((action) => [action.id, action]));

export const isKnownActionId = (id: string) => ACTIONS_BY_ID.has(id) || isMacroActionId(id);

// The command an action id stands for, or null for an id nothing implements
// (a stale stored binding).
export const commandFor = (id: string): ActionCommand | null => {
  const def = ACTIONS_BY_ID.get(id);
  if (def) return def.command;
  if (isMacroActionId(id) && id.length > MACRO_ACTION_PREFIX.length) {
    return { kind: "macro", uuid: id.slice(MACRO_ACTION_PREFIX.length) };
  }
  return null;
};

export type ActionContext = {
  // The WebSocket to UGS is up.
  connected: boolean;
  // The controller state string from the status slice ("IDLE", "RUN", ...).
  state: string;
  // A file is loaded in UGS.
  hasFile: boolean;
};

const IDLE_OR_JOG = ["IDLE", "JOG"];
const NO_ADJUST = ["DISCONNECTED", "CONNECTING", "ALARM"];

export const isCommandAvailable = (command: ActionCommand, ctx: ActionContext): boolean => {
  if (!ctx.connected) return false;
  const { state } = ctx;
  switch (command.kind) {
    case "jog":
    case "macro":
      return IDLE_OR_JOG.includes(state);
    case "step":
    case "feed":
      // Only edits the stored jog settings - fine in any state.
      return true;
    case "override":
      return !NO_ADJUST.includes(state);
    case "job":
      if (command.op === "start") return ctx.hasFile && (state === "IDLE" || state === "HOLD");
      if (command.op === "pause") return state === "RUN" || state === "CHECK";
      return ["RUN", "HOLD", "CHECK", "JOG"].includes(state);
    case "zero":
      return state === "IDLE";
    case "machine":
      if (command.op === "unlock") return true;
      if (command.op === "softReset") return state !== "DISCONNECTED";
      return state === "IDLE";
  }
};
