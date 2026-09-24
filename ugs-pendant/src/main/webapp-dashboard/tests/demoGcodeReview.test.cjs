const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const ts = require("typescript");
const vm = require("node:vm");

const source = fs.readFileSync(path.join(__dirname, "../src/demo/gcodeReview.ts"), "utf8");
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText;
const sandbox = { exports: {}, Set, RegExp };
vm.runInNewContext(compiled, sandbox);
const { reviewGcode, splitCommand } = sandbox.exports;
// Values built inside the vm have their own prototypes, which deepEqual treats as different.
const plain = (value) => JSON.parse(JSON.stringify(value));

// Same cases as GcodeReviewServiceTest.java, so the demo agrees with the real service.
test("reports malformed numbers, unknown codes and multiple motion codes with their source lines", () => {
  const result = reviewGcode("job.nc", ["G21", "G1 X10 Y10 F100", "G1 Xbad Y20", "G999 X30", "G0 G1 X40"].join("\n"));
  assert.equal(result.lineCount, 5);
  const find = (line) => result.diagnostics.filter((d) => d.lineNumber === line);
  assert.ok(find(3).some((d) => d.severity === "ERROR" && d.message.includes("Malformed numeric word") && d.source === "G1 Xbad Y20"));
  assert.ok(find(4).some((d) => d.severity === "WARNING" && d.message.includes("Unknown G-code 'G999'")));
  assert.ok(find(5).some((d) => d.severity === "ERROR" && d.message.includes("multiple")));
  assert.equal(find(1).length + find(2).length, 0);
});

test("comments and ordinary modal moves are clean", () => {
  assert.equal(reviewGcode("job.nc", ["; comment", "G21", "G1 X10 Y10", "Y20", "(a comment with G999 in it)"].join("\n")).diagnostics.length, 0);
});

test("non-modal codes are not counted as multiple motion codes", () => {
  assert.equal(reviewGcode("job.nc", ["G53 G0 X10", "G28", "G10 L2 P1 X0", "G4 P1"].join("\n")).diagnostics.length, 0);
});

test("leading zeros and packed words are read like the real parser", () => {
  assert.equal(reviewGcode("j", "G01 X1 Y2\nG00Z5\nG38.2 Z-5 F50").diagnostics.length, 0);
  assert.deepEqual(plain(splitCommand("G1X10Y-5.5F300")), ["G1", "X10", "Y-5.5", "F300"]);
  assert.deepEqual(plain(splitCommand("G1 X1 (note) ; tail")), ["G1", "X1", "(note)", "; tail"]);
});

test("grbl system lines are ignored and an empty file has one (blank) line", () => {
  assert.equal(reviewGcode("j", "$H\n$X").diagnostics.length, 0);
  assert.equal(reviewGcode("j", "").lineCount, 1);
});

test("the bundled samples only draw findings on their O-word/M66 macro lines", () => {
  // heart.gcode carries a FluidNC-style probe macro (o100 if ... endif, M66) that
  // the real review service flags too - see GcodeReviewService's word rules.
  const dir = path.join(__dirname, "../src/demo/samples");
  for (const name of fs.readdirSync(dir)) {
    const result = reviewGcode(name, fs.readFileSync(path.join(dir, name), "utf8"));
    const unexpected = result.diagnostics.filter((d) => !/^(o\d+|M66)\b/i.test(d.source));
    assert.deepEqual(plain(unexpected), [], name);
  }
});
