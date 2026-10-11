// "Ignore" for G-code review findings.
//
// A finding is ignored by its *message* (plus severity), not by line number:
// a review is recomputed from the editor text every time, and line numbers
// shift as the file is edited, so a line-keyed ignore would reappear after the
// first insertion above it. The message already names the offending word or
// code ("Unknown M-code 'M66'...", "Malformed numeric word 'if5399'"), so
// ignoring one hides exactly that finding wherever it occurs and nothing else.

type Finding = { severity: string; message: string };

export const REVIEW_IGNORE_STORAGE_KEY = "ugs-dashboard-gcode-review-ignored";
const MAX_IGNORED = 300;

export const findingKey = (finding: Finding): string => `${finding.severity}|${finding.message}`;

export function splitIgnored<T extends Finding>(findings: T[], ignored: ReadonlySet<string>) {
  const active: T[] = [];
  const hidden: T[] = [];
  for (const finding of findings) {
    (ignored.has(findingKey(finding)) ? hidden : active).push(finding);
  }
  return { active, hidden };
}

export const loadIgnoredFindings = (): string[] => {
  try {
    const parsed = JSON.parse(localStorage.getItem(REVIEW_IGNORE_STORAGE_KEY) ?? "[]");
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string") : [];
  } catch {
    return [];
  }
};

// Newest last; the oldest are dropped past the cap so the list can't grow
// without bound across years of reviews.
export const saveIgnoredFindings = (keys: string[]): void => {
  try {
    localStorage.setItem(REVIEW_IGNORE_STORAGE_KEY, JSON.stringify(keys.slice(-MAX_IGNORED)));
  } catch {
    // Storage unavailable (private window, quota): ignoring still works for
    // this page view, it just isn't remembered.
  }
};
