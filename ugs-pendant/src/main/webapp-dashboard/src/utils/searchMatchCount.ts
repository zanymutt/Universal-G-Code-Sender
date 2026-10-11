// "12/345" for the find panel: which match the selection is on, out of how
// many. Counting stops at a cap so a pattern like "G1" on a 100k-line file
// can't stall the editor; past it the total reads "99,999+".

export const MAX_COUNTED_MATCHES = 99_999;

export type MatchCount = {
  // 1-based index of the match the selection is exactly on; 0 when the
  // selection isn't on a match (nothing has been stepped to yet).
  current: number;
  total: number;
  capped: boolean;
};

type Range = { from: number; to: number };

// `matches` is whatever yields the document's matches in order - in the editor
// a SearchQuery cursor - so this stays free of any CodeMirror import.
export function countMatches(
  matches: Iterable<Range>,
  selection: Range,
  max: number = MAX_COUNTED_MATCHES
): MatchCount {
  let total = 0;
  let current = 0;
  for (const match of matches) {
    total += 1;
    if (current === 0 && match.from === selection.from && match.to === selection.to) current = total;
    if (total >= max) return { current, total, capped: true };
  }
  return { current, total, capped: false };
}

const grouped = (value: number) => value.toLocaleString("en-US");

export type MatchCountLabel = { text: string; state: "idle" | "found" | "none" | "invalid" };

// What the panel shows. `null` means there is nothing to count (empty field).
export function formatMatchCount(count: MatchCount | null, valid = true): MatchCountLabel {
  if (!valid) return { text: "Invalid", state: "invalid" };
  if (count === null) return { text: "", state: "idle" };
  if (count.total === 0) return { text: "No matches", state: "none" };
  const current = count.current > 0 ? grouped(count.current) : "–";
  return { text: `${current}/${grouped(count.total)}${count.capped ? "+" : ""}`, state: "found" };
}
