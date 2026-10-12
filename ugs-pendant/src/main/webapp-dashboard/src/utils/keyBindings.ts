import { ACTIONS, isKnownActionId } from "./dashboardActions";
import { DEFAULT_PAD_TUNING, describeInput, isPadInput, PadTuning, sanitizePadTuning } from "./gamepadInput";

// Which keys trigger which dashboard actions. A "combo" is a string such as
// "ArrowLeft" or "Shift+Numpad4": zero or more modifiers in a fixed order
// followed by a KeyboardEvent.code. `code` (the physical key) is used rather
// than `key` so a numeric keypad stays distinct from the digit row and doesn't
// change meaning with NumLock or the keyboard layout.

export type KeyBindings = Record<string, string[]>;

export type KeyBindingSettings = {
  // Off until the person turns it on - nothing should jog the machine because
  // a key was pressed on a shared tablet.
  enabled: boolean;
  // Controller (gamepad) input is switched on separately from the keyboard.
  gamepadEnabled: boolean;
  // Chrome keeps reading a controller while the page is visible even when it is
  // not the focused window, so by default the dashboard only acts on it while
  // it IS focused. On means it also answers from behind another window.
  gamepadWhenUnfocused: boolean;
  // How far a stick or trigger must be pushed to count as pressed, and how close
  // to rest it must return to count as released (fractions of full travel).
  padTuning: PadTuning;
  // Holding a jog key keeps the machine moving until it is released (a tap is
  // still one step). Off by default so keys behave exactly as before.
  holdToJog: boolean;
  // Action id -> combos. An action id mapped to [] is deliberately unbound.
  bindings: KeyBindings;
};

export const KEY_BINDINGS_STORAGE_KEY = "ugs-dashboard-key-bindings";

export const defaultBindings = (): KeyBindings => {
  const bindings: KeyBindings = {};
  for (const action of ACTIONS) bindings[action.id] = [...action.defaults];
  return bindings;
};

export const defaultKeyBindingSettings = (): KeyBindingSettings => ({
  enabled: false,
  gamepadEnabled: false,
  gamepadWhenUnfocused: false,
  padTuning: { ...DEFAULT_PAD_TUNING },
  holdToJog: false,
  bindings: defaultBindings(),
});

const MODIFIER_CODE = /^(Shift|Control|Alt|Meta|OS)(Left|Right)?$/;
// Tab and Escape keep their job: moving focus, and cancelling "press a key".
const RESERVED_CODES = new Set(["Tab", "Escape"]);
const COMBO_PATTERN = /^(((Ctrl|Alt|Shift|Meta)\+)*[A-Za-z0-9]+|Pad\.(B\d+|A\d+[+-]|Hat[NESW]))$/;

type KeyEventLike = {
  code: string;
  ctrlKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
  metaKey: boolean;
};

// The combo a key event represents, or null if it can't be bound (a lone
// modifier, Tab/Escape, or a key the browser can't identify).
export const comboFromEvent = (event: KeyEventLike): string | null => {
  const { code } = event;
  if (!code || code === "Unidentified" || MODIFIER_CODE.test(code) || RESERVED_CODES.has(code)) return null;
  const parts: string[] = [];
  if (event.ctrlKey) parts.push("Ctrl");
  if (event.altKey) parts.push("Alt");
  if (event.shiftKey) parts.push("Shift");
  if (event.metaKey) parts.push("Meta");
  parts.push(code);
  return parts.join("+");
};

const CODE_LABELS: Record<string, string> = {
  ArrowLeft: "←",
  ArrowRight: "→",
  ArrowUp: "↑",
  ArrowDown: "↓",
  PageUp: "PgUp",
  PageDown: "PgDn",
  Space: "Space",
  Backquote: "`",
  Minus: "-",
  Equal: "=",
  BracketLeft: "[",
  BracketRight: "]",
  Backslash: "\\",
  Semicolon: ";",
  Quote: "'",
  Comma: ",",
  Period: ".",
  Slash: "/",
  NumpadAdd: "Num +",
  NumpadSubtract: "Num -",
  NumpadMultiply: "Num *",
  NumpadDivide: "Num /",
  NumpadDecimal: "Num .",
  NumpadEnter: "Num Enter",
};

const formatCode = (code: string): string => {
  if (CODE_LABELS[code]) return CODE_LABELS[code];
  const letter = /^Key([A-Z])$/.exec(code);
  if (letter) return letter[1];
  const digit = /^Digit([0-9])$/.exec(code);
  if (digit) return digit[1];
  const numpad = /^Numpad([0-9])$/.exec(code);
  if (numpad) return `Num ${numpad[1]}`;
  return code;
};

export const formatCombo = (combo: string): string => {
  if (isPadInput(combo)) return describeInput(combo);
  const parts = combo.split("+");
  const code = parts.pop() ?? "";
  return [...parts, formatCode(code)].join("+");
};

const isValidCombo = (value: unknown): value is string =>
  typeof value === "string" && COMBO_PATTERN.test(value) && !RESERVED_CODES.has(value.split("+").pop() ?? "");

// Anything read back from storage is checked: unknown action ids and malformed
// combos are dropped, and a combo can belong to only one action (first wins),
// so a hand-edited or stale entry can't make one key do two things. Actions
// the stored copy has never heard of (added in a later version) get their
// defaults, but an action the person emptied stays empty.
export const sanitizeKeyBindingSettings = (raw: unknown): KeyBindingSettings => {
  const result = defaultKeyBindingSettings();
  if (!raw || typeof raw !== "object") return result;
  const input = raw as {
    enabled?: unknown;
    gamepadEnabled?: unknown;
    gamepadWhenUnfocused?: unknown;
    padTuning?: unknown;
    holdToJog?: unknown;
    bindings?: unknown;
  };
  result.enabled = input.enabled === true;
  result.gamepadEnabled = input.gamepadEnabled === true;
  result.gamepadWhenUnfocused = input.gamepadWhenUnfocused === true;
  result.padTuning = sanitizePadTuning(
    input.padTuning && typeof input.padTuning === "object" ? (input.padTuning as Partial<PadTuning>) : null
  );
  result.holdToJog = input.holdToJog === true;
  if (!input.bindings || typeof input.bindings !== "object") return result;

  const stored = input.bindings as Record<string, unknown>;
  const claimed = new Set<string>();
  const next: KeyBindings = {};
  for (const [actionId, combos] of Object.entries(stored)) {
    if (!isKnownActionId(actionId) || !Array.isArray(combos)) continue;
    const kept: string[] = [];
    for (const combo of combos) {
      if (isValidCombo(combo) && !claimed.has(combo)) {
        claimed.add(combo);
        kept.push(combo);
      }
    }
    next[actionId] = kept;
  }
  for (const action of ACTIONS) {
    if (next[action.id] === undefined) {
      // A default that another stored action already took stays with that one.
      next[action.id] = action.defaults.filter((combo) => !claimed.has(combo));
      next[action.id].forEach((combo) => claimed.add(combo));
    }
  }
  result.bindings = next;
  return result;
};

// The action a combo is bound to, if any.
export const actionForCombo = (bindings: KeyBindings, combo: string): string | null => {
  for (const [actionId, combos] of Object.entries(bindings)) {
    if (combos.includes(combo)) return actionId;
  }
  return null;
};

export type AssignResult = {
  bindings: KeyBindings;
  // The action that held this combo before and lost it, if any.
  displaced: string | null;
};

// Binds a combo to an action. A combo can only do one thing, so it is taken
// from whichever action had it.
export const assignCombo = (bindings: KeyBindings, actionId: string, combo: string): AssignResult => {
  const displaced = actionForCombo(bindings, combo);
  const next: KeyBindings = {};
  for (const [id, combos] of Object.entries(bindings)) {
    next[id] = combos.filter((existing) => existing !== combo);
  }
  const mine = next[actionId] ?? [];
  next[actionId] = [...mine, combo];
  return { bindings: next, displaced: displaced === actionId ? null : displaced };
};

export type BindingKind = "keyboard" | "pad";

// Puts one kind of binding (the keyboard's or the controller's) back to its
// shipped state without touching the other kind. Controllers ship with none.
export const resetBindingsForKind = (bindings: KeyBindings, kind: BindingKind): KeyBindings => {
  const defaults = defaultBindings();
  const next: KeyBindings = {};
  for (const id of new Set([...Object.keys(bindings), ...Object.keys(defaults)])) {
    const keep = (bindings[id] ?? []).filter((combo) => isPadInput(combo) !== (kind === "pad"));
    next[id] = kind === "keyboard" ? [...keep, ...(defaults[id] ?? [])] : keep;
  }
  return next;
};

// What an import does to the bindings: for each chosen kind, the incoming file's
// inputs of that kind replace the current ones; the other kind is left alone.
export const mergeImportedBindings = (
  current: KeyBindings,
  incoming: KeyBindings,
  kinds: { keyboard: boolean; pad: boolean }
): KeyBindings => {
  const next: KeyBindings = {};
  for (const id of new Set([...Object.keys(current), ...Object.keys(incoming)])) {
    const mine = current[id] ?? [];
    const theirs = incoming[id] ?? [];
    const keepFromCurrent = mine.filter((combo) => (isPadInput(combo) ? !kinds.pad : !kinds.keyboard));
    const takeFromFile = theirs.filter((combo) => (isPadInput(combo) ? kinds.pad : kinds.keyboard));
    next[id] = [...keepFromCurrent, ...takeFromFile];
  }
  return next;
};

export const removeCombo = (bindings: KeyBindings, actionId: string, combo: string): KeyBindings => ({
  ...bindings,
  [actionId]: (bindings[actionId] ?? []).filter((existing) => existing !== combo),
});

// ---- what a key press is allowed to do -----------------------------------

type TargetLike = {
  tagName?: string;
  type?: string;
  isContentEditable?: boolean;
  closest?: (selector: string) => unknown;
  getAttribute?: (name: string) => string | null;
};

// Input types where arrow keys / Space / Enter do nothing a shortcut would
// steal from: a focused step-size radio button must not swallow a jog key.
const NON_TEXT_INPUT_TYPES = new Set(["radio", "checkbox", "button", "submit", "reset", "image", "file", "color"]);

// True when the key is probably meant for the thing being typed into, so a
// shortcut must stay out of the way: text inputs, selects, the code editor,
// the console and any contenteditable.
export const isTypingTarget = (target: TargetLike | null | undefined): boolean => {
  if (!target) return false;
  const tag = (target.tagName ?? "").toUpperCase();
  if (tag === "TEXTAREA" || tag === "SELECT") return true;
  if (tag === "INPUT") return !NON_TEXT_INPUT_TYPES.has((target.type ?? "text").toLowerCase());
  if (target.isContentEditable) return true;
  if (typeof target.closest === "function") {
    return Boolean(target.closest(".cm-editor, [contenteditable=''], [contenteditable='true'], [role='textbox']"));
  }
  return false;
};

const ACTIVATION_CODES = new Set(["Enter", "NumpadEnter", "Space"]);

// Enter/Space on a focused button or link activates it; binding those keys must
// not also fire an action when the person was just pressing that control.
export const isActivationOnControl = (code: string, target: TargetLike | null | undefined): boolean => {
  if (!target || !ACTIVATION_CODES.has(code)) return false;
  const tag = (target.tagName ?? "").toUpperCase();
  if (tag === "BUTTON" || tag === "A" || tag === "SUMMARY") return true;
  if (tag === "INPUT") return NON_TEXT_INPUT_TYPES.has((target.type ?? "text").toLowerCase());
  const role = typeof target.getAttribute === "function" ? target.getAttribute("role") : null;
  return role === "button" || role === "link" || role === "menuitem";
};
