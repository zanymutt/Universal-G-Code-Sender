import { PadTuning, isPadInput, sanitizePadTuning } from "./gamepadInput";
import { isMacroActionId } from "./dashboardActions";
import { KeyBindings, KeyBindingSettings, sanitizeKeyBindingSettings } from "./keyBindings";

// A file copy of this device's key and controller bindings, so they can be kept
// as a backup or moved to another computer (browser storage is per device).
//
// What is deliberately NOT in it: whether shortcuts and the controller are
// switched on, the focus rule, and hold-to-jog. Those are per-device safety
// decisions; importing a file must never switch the machine's keys on.
export const INPUT_BACKUP_APP = "ugs-dashboard-input-bindings";
export const INPUT_BACKUP_VERSION = 1;
const MAX_FILE_BYTES = 256 * 1024;

export type InputBackup = {
  app: typeof INPUT_BACKUP_APP;
  version: number;
  exportedAt: string;
  bindings: KeyBindings;
  padTuning: PadTuning;
};

export type BindingCounts = { keyboard: number; pad: number; macros: number };

export type ParsedInputBackup = {
  backup: Omit<InputBackup, "padTuning"> & { padTuning: PadTuning | null };
  counts: BindingCounts;
  // Entries in the file that were not usable and have been dropped.
  skipped: number;
};

export type InputBackupParseResult = { ok: true; value: ParsedInputBackup } | { ok: false; error: string };

export const countBindings = (bindings: KeyBindings): BindingCounts => {
  const counts: BindingCounts = { keyboard: 0, pad: 0, macros: 0 };
  for (const [actionId, combos] of Object.entries(bindings)) {
    for (const combo of combos) {
      if (isPadInput(combo)) counts.pad++;
      else counts.keyboard++;
      if (isMacroActionId(actionId)) counts.macros++;
    }
  }
  return counts;
};

export const buildInputBackup = (settings: KeyBindingSettings, now: Date = new Date()): InputBackup => ({
  app: INPUT_BACKUP_APP,
  version: INPUT_BACKUP_VERSION,
  exportedAt: now.toISOString(),
  bindings: settings.bindings,
  padTuning: settings.padTuning,
});

export const inputBackupFilename = (now: Date = new Date()) =>
  `ugs-dashboard-input-bindings-${now.toISOString().slice(0, 10)}.json`;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === "object" && !Array.isArray(value);

// Validates a file with the same rules the app applies to its own stored
// bindings, dropping (and counting) anything unusable rather than rejecting the
// whole file for one bad entry.
export const parseInputBackup = (text: string): InputBackupParseResult => {
  if (text.length > MAX_FILE_BYTES) return { ok: false, error: "That file is too large to be a bindings backup." };
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    return { ok: false, error: "That file is not valid JSON." };
  }
  if (!isRecord(data) || data.app !== INPUT_BACKUP_APP) {
    return { ok: false, error: "That file is not a UGS Dashboard key and controller bindings backup." };
  }
  if (typeof data.version !== "number" || data.version > INPUT_BACKUP_VERSION) {
    return { ok: false, error: "That backup was made by a newer version of the Dashboard. Update the Dashboard first." };
  }
  if (!isRecord(data.bindings)) {
    return { ok: false, error: "That backup has no bindings in it." };
  }

  let rawCombos = 0;
  for (const combos of Object.values(data.bindings)) {
    if (Array.isArray(combos)) rawCombos += combos.length;
  }
  const bindings = sanitizeKeyBindingSettings({ bindings: data.bindings }).bindings;
  // Defaults the sanitiser fills in for actions the file does not mention are
  // not file content: keep only what survived of what the file itself held.
  const fromFile: KeyBindings = {};
  for (const [actionId, combos] of Object.entries(data.bindings)) {
    if (!Array.isArray(combos) || !(actionId in bindings)) continue;
    fromFile[actionId] = bindings[actionId].filter((combo) => combos.includes(combo));
  }
  const kept = Object.values(fromFile).reduce((sum, combos) => sum + combos.length, 0);

  return {
    ok: true,
    value: {
      backup: {
        app: INPUT_BACKUP_APP,
        version: data.version,
        exportedAt: typeof data.exportedAt === "string" ? data.exportedAt : "",
        bindings: fromFile,
        padTuning: isRecord(data.padTuning) ? sanitizePadTuning(data.padTuning as Partial<PadTuning>) : null,
      },
      counts: countBindings(fromFile),
      skipped: Math.max(0, rawCombos - kept),
    },
  };
};
