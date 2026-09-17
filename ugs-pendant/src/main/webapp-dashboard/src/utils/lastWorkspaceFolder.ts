// Shared between OpenFileModal and SaveAsModal - "remember where I was" means
// the same thing whether that folder was last reached by opening or by
// saving, so both read/write this one key rather than keeping independent
// memories that could disagree with each other. Purely a per-browser
// convenience (not synced to the workspace itself), so a stale or foreign
// value here should just be ignored rather than treated as something that
// needs validating against the backend.
const LAST_FOLDER_KEY = "ugsDashboard.lastWorkspaceFolder";

export const readLastWorkspaceFolder = (): string[] => {
  try {
    const stored = localStorage.getItem(LAST_FOLDER_KEY);
    const parsed = stored ? JSON.parse(stored) : [];
    return Array.isArray(parsed) && parsed.every((segment) => typeof segment === "string") ? parsed : [];
  } catch {
    return [];
  }
};

export const writeLastWorkspaceFolder = (path: string[]): void => {
  try {
    localStorage.setItem(LAST_FOLDER_KEY, JSON.stringify(path));
  } catch {
    // Best-effort - a folder that isn't remembered next time isn't worth
    // failing the navigation/save itself over (private browsing, storage full).
  }
};
