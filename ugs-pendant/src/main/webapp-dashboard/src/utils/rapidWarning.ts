// Wording for the Stock view's "a rapid move cuts into the stock" warning. The
// simulator reports segment indices; the person thinks in file lines. Pure, so
// it is unit-tested in node (tests/rapidWarning.test.cjs).

export type RapidWarning = {
  count: number;
  // File lines of the offending moves, ascending, without repeats.
  lines: number[];
  text: string;
  title: string;
};

// Most lines named in the tooltip before it trails off.
const MAX_LINES_LISTED = 8;

// `first` are the segment indices of the first few offending moves (what the
// simulator sends); `segments` is the loaded toolpath they index into. null
// when there is nothing to warn about.
export const describeRapidHits = (
  count: number,
  first: number[],
  segments: { lineNumber: number }[]
): RapidWarning | null => {
  if (count <= 0) return null;
  const lines: number[] = [];
  for (const index of first) {
    const segment = segments[index];
    if (!segment) continue;
    if (lines.length === 0 || lines[lines.length - 1] !== segment.lineNumber) lines.push(segment.lineNumber);
  }
  const unique = [...new Set(lines)].sort((a, b) => a - b);
  const moves = `${count} rapid move${count === 1 ? "" : "s"}`;
  const where = unique.length > 0 ? ` (first at line ${unique[0]})` : "";
  const listed = unique.slice(0, MAX_LINES_LISTED).join(", ");
  const more = count > unique.length || unique.length > MAX_LINES_LISTED ? ", ..." : "";
  return {
    count,
    lines: unique,
    text: `${moves} cut into the stock${where}`,
    title:
      `A rapid (G0) move runs the cutter through material that has not been cleared yet` +
      (unique.length > 0 ? `, at line${unique.length === 1 ? "" : "s"} ${listed}${more}` : "") +
      `. Check the Z clearance before it, or - if the stock itself looks wrong - the top of the stock in the Stock settings.`,
  };
};
