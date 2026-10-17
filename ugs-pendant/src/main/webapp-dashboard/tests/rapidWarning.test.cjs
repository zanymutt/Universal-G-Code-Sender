const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const ts = require("typescript");
const vm = require("node:vm");

const source = fs.readFileSync(path.join(__dirname, "../src/utils/rapidWarning.ts"), "utf8");
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
}).outputText;
const sandbox = { exports: {}, Set };
vm.runInNewContext(compiled, sandbox);
const { describeRapidHits } = sandbox.exports;
const plain = (value) => JSON.parse(JSON.stringify(value));

const segments = [10, 10, 20, 30, 40].map((lineNumber) => ({ lineNumber }));

test("nothing to say when no rapid cuts into the stock", () => {
  assert.equal(describeRapidHits(0, [], segments), null);
});

test("names the count and the first file line", () => {
  const warning = plain(describeRapidHits(1, [2], segments));
  assert.equal(warning.text, "1 rapid move cut into the stock (first at line 20)");
  assert.deepEqual(warning.lines, [20]);
  assert.match(warning.title, /at line 20\./);
});

test("several segments on one line count once in the line list, but all in the total", () => {
  const warning = plain(describeRapidHits(3, [0, 1, 3], segments));
  assert.equal(warning.text, "3 rapid moves cut into the stock (first at line 10)");
  assert.deepEqual(warning.lines, [10, 30]);
});

test("more hits than were reported trail off in the tooltip", () => {
  const warning = plain(describeRapidHits(500, [0, 2, 3], segments));
  assert.deepEqual(warning.lines, [10, 20, 30]);
  assert.match(warning.title, /lines 10, 20, 30, \.\.\./);
});

test("an index that is not in the loaded toolpath is ignored", () => {
  const warning = plain(describeRapidHits(2, [99], segments));
  assert.deepEqual(warning.lines, []);
  assert.equal(warning.text, "2 rapid moves cut into the stock");
});
