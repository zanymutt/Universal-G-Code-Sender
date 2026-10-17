const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const ts = require("typescript");
const vm = require("node:vm");

const source = fs.readFileSync(path.join(__dirname, "../src/utils/programEvents.ts"), "utf8");
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
}).outputText;
const sandbox = { exports: {}, Math };
vm.runInNewContext(compiled, sandbox);
const { scanProgramEvents, toolChangeEvents, mergeProgramEvents } = sandbox.exports;
const plain = (value) => JSON.parse(JSON.stringify(value));
const scan = (text) => plain(scanProgramEvents(text));

test("MSG and PRINT comments are messages, any letter case", () => {
  assert.deepEqual(scan("G0 X1\n(MSG, Clamp the board)\n(print,hello)\nG1 X2\n"), [
    { line: 2, kind: "message", text: "Clamp the board" },
    { line: 3, kind: "message", text: "hello" },
  ]);
});

test("ordinary comments and an empty message are not events", () => {
  assert.deepEqual(scan("( Made using CamBam )\n(MSG,)\n; just a note\nG1 X1\n"), []);
});

test("M0 is a stop; a comment on the same line explains it", () => {
  assert.deepEqual(scan("G1 X1\nM0 (change to the 3 mm bit)\nG1 X2\n"), [
    { line: 2, kind: "stop", text: "Program stop (M0): change to the 3 mm bit" },
  ]);
  assert.deepEqual(scan("M00\n"), [{ line: 1, kind: "stop", text: "Program stop (M0)" }]);
});

test("a message just above an M0 becomes that stop's reason instead of a separate event", () => {
  assert.deepEqual(scan("G1 X1\n(MSG, flip the board)\nG0 Z5\nM0\nG1 X2\n"), [
    { line: 4, kind: "stop", text: "Program stop (M0): flip the board" },
  ]);
  // Far above: stays a message of its own.
  const far = scan("(MSG, hello)\nG1 X1\nG1 X2\nG1 X3\nG1 X4\nM0\n");
  assert.equal(far.length, 2);
  assert.equal(far[0].kind, "message");
  assert.equal(far[1].text, "Program stop (M0)");
});

test("a message on the M0 line itself is its reason", () => {
  assert.deepEqual(scan("M0 (MSG, insert the V-bit)\n"), [
    { line: 1, kind: "stop", text: "Program stop (M0): insert the V-bit" },
  ]);
});

test("M1 is an optional stop: shown, never a stop", () => {
  assert.deepEqual(scan("M1\nM01 (check depth)\n"), [
    { line: 1, kind: "message", text: "Optional stop (M1)" },
    { line: 2, kind: "message", text: "Optional stop (M1): check depth" },
  ]);
});

test("M03, M05, M10 and M30 are not stops", () => {
  assert.deepEqual(scan("M3 S1000\nM03\nM05\nM10\nM30\nM100\n"), []);
});

test("an M0 inside a comment is not a stop", () => {
  assert.deepEqual(scan("(go to M0 now)\n; M0 later\n"), []);
});

test("tool changes become stops, and lists merge in file order", () => {
  const changes = toolChangeEvents([{ line: 5, tool: 2 }], (tool) => `T${tool} (Ball nose 3 mm)`);
  assert.deepEqual(plain(changes), [{ line: 5, kind: "stop", text: "Tool change: T2 (Ball nose 3 mm)" }]);
  const merged = plain(mergeProgramEvents(changes, scanProgramEvents("(MSG, a)\n\n\n\n(MSG, b)\n(MSG, c)\n")));
  assert.deepEqual(merged.map((e) => e.line), [1, 5, 5, 6]);
  assert.equal(merged[1].kind, "stop"); // tool change listed first (it was first in the arguments)
});
