// The demo's stand-in for the backend's G-code review (GcodeReviewService.java,
// served at /api/v1/review). It repeats that service's own checks - an unknown
// G/M-code is a warning, a malformed number is an error, and more than one
// motion code in a block is an error - using the same word splitting and the
// same list of codes UGS knows (Code.java). What it can't reproduce is the
// shared GcodeParser's own rejections, so the real app may report a few more
// errors than this does.

export type ReviewDiagnostic = {
  lineNumber: number;
  severity: "ERROR" | "WARNING";
  message: string;
  source: string;
};

export type ReviewResult = {
  fileName: string;
  lineCount: number;
  diagnostics: ReviewDiagnostic[];
};

// Code.java's enum, spelled the way Code.lookupCode() normalises words ("G01" -> "G1").
const KNOWN_CODES = new Set(
  (
    "G4 G10 G28 G28.1 G28.2 G28.3 G30 G53 G80 G92 G92.1 G92.2 G92.3 G0 G1 G2 G3 G33 G38.2 G38.3 G38.4 G38.5 " +
    "G73 G76 G81 G82 G83 G84 G85 G86 G87 G88 G89 G17 G18 G19 G17.1 G18.1 G19.1 G90 G91 G90.1 G91.1 G93 G94 G95 " +
    "G20 G21 G40 G41 G42 G41.1 G42.1 G43 G43.1 G49 G98 G99 G54 G55 G56 G57 G58 G59 G59.1 G59.2 G59.3 G61 G61.1 " +
    "G64 G96 G97 G7 G8 M0 M1 M2 M30 M60 M3 M4 M5 M6 M7 M8 M9 M48 M49"
  ).split(" ")
);

const MOTION_CODES = new Set([
  "G0", "G1", "G2", "G3", "G38.2", "G38.3", "G38.4", "G38.5",
  "G80", "G81", "G82", "G83", "G84", "G85", "G86", "G87", "G88", "G89",
]);

// Address letters the numeric check applies to (GcodeReviewService.NUMERIC_WORD).
const NUMERIC_ADDRESSES = "GMXYZABCIJKRFSNTPLOUVWHEQD";

const isDigit = (c: string) => c >= "0" && c <= "9";
const isLetter = (c: string) => /\p{L}/u.test(c);

// GcodePreprocessorUtils.splitCommand: whitespace is dropped, a word is a letter
// run followed by a number, and comments come through as their own words.
export const splitCommand = (command: string): string[] => {
  if (command.startsWith("$")) return [command];
  const words: string[] = [];
  let readNumeric = false;
  let readLineComment = false;
  let blockDepth = 0;
  let current = "";
  for (const c of command) {
    if (c === "(" && !readLineComment) {
      if (blockDepth === 0 && current.length > 0) {
        words.push(current);
        current = "";
      }
      current += c;
      blockDepth++;
      readNumeric = false;
      continue;
    }
    if (blockDepth > 0 && c === ")") {
      current += c;
      blockDepth--;
      if (blockDepth === 0) {
        words.push(current);
        current = "";
      }
      continue;
    }
    if (c === ";" && !readLineComment && blockDepth === 0) {
      if (current.length > 0) {
        words.push(current);
        current = "";
      }
      current += c;
      readLineComment = true;
      continue;
    }
    if (readLineComment || blockDepth > 0) {
      current += c;
    } else if (/\s/.test(c)) {
      continue;
    } else if (readNumeric && !isDigit(c) && c !== ".") {
      readNumeric = false;
      words.push(current);
      current = "";
      if (isLetter(c)) current += c;
    } else if (isDigit(c) || c === "." || c === "-") {
      current += c;
      readNumeric = true;
    } else if (isLetter(c)) {
      current += c;
    }
  }
  if (current.length > 0) words.push(current);
  return words;
};

// Code.lookupCode: leading zeros come off the number, but a lone zero stays.
const normaliseCode = (word: string): string => {
  const letter = word[0].toUpperCase();
  let start = 1;
  for (let i = 1; i < word.length; i++) {
    start = i;
    if (word[i] !== "0") break;
  }
  return letter + word.slice(start);
};

// Double.parseDouble + isFinite, close enough for G-code words.
const isFiniteNumber = (value: string): boolean => /^[-+]?(\d+\.?\d*|\.\d+)([eE][-+]?\d+)?$/.test(value);

const inspectWords = (line: string, lineNumber: number, diagnostics: ReviewDiagnostic[]) => {
  let motionCodes = 0;
  for (const word of splitCommand(line)) {
    if (word === "" || word.startsWith("(") || word.startsWith(";") || word.startsWith("$")) continue;
    const address = word[0].toUpperCase();
    if (address === "G" || address === "M") {
      const code = normaliseCode(word);
      if (!KNOWN_CODES.has(code)) {
        diagnostics.push({
          lineNumber,
          severity: "WARNING",
          message: `Unknown ${address}-code '${word}'. The controller may support it.`,
          source: line,
        });
      } else if (MOTION_CODES.has(code)) {
        motionCodes++;
      }
    }
    if (word.length > 1 && NUMERIC_ADDRESSES.includes(address) && !isFiniteNumber(word.slice(1))) {
      diagnostics.push({
        lineNumber,
        severity: "ERROR",
        message: `Malformed numeric word '${word}'.`,
        source: line,
      });
    }
  }
  if (motionCodes > 1) {
    diagnostics.push({ lineNumber, severity: "ERROR", message: "multiple motion codes appear in one block.", source: line });
  }
};

export const reviewGcode = (fileName: string, content: string): ReviewResult => {
  const lines = (content ?? "").split(/\r\n|\r|\n/);
  const diagnostics: ReviewDiagnostic[] = [];
  lines.forEach((line, index) => inspectWords(line, index + 1, diagnostics));
  return { fileName, lineCount: lines.length, diagnostics };
};
