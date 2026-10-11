const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const ts = require("typescript");
const vm = require("node:vm");

const source = fs.readFileSync(path.join(__dirname, "../src/utils/searchMatchCount.ts"), "utf8");
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: "ES2020" } }).outputText;
const sandbox = { exports: {}, Number, Math };
vm.runInNewContext(compiled, sandbox);
const { countMatches, formatMatchCount, MAX_COUNTED_MATCHES } = sandbox.exports;
// The module runs in a vm context, so compare via JSON rather than deepEqual.
const json = (v) => JSON.stringify(v);

const at = (...starts) => starts.map((from) => ({ from, to: from + 3 }));

test("counts every match and finds the one the selection is on", () => {
  const c = countMatches(at(10, 20, 30, 40), { from: 30, to: 33 });
  assert.equal(json(c), json({ current: 3, total: 4, capped: false }));
});

test("selection not on a match gives current 0", () => {
  assert.equal(json(countMatches(at(10, 20), { from: 11, to: 14 })), json({ current: 0, total: 2, capped: false }));
  assert.equal(json(countMatches(at(10, 20), { from: 10, to: 10 })), json({ current: 0, total: 2, capped: false }));
});

test("no matches", () => {
  assert.equal(json(countMatches([], { from: 0, to: 0 })), json({ current: 0, total: 0, capped: false }));
});

test("stops at the cap and says so, still reporting the current match if it came first", () => {
  const many = Array.from({ length: 50 }, (_, i) => ({ from: i * 10, to: i * 10 + 2 }));
  const c = countMatches(many, { from: 30, to: 32 }, 20);
  assert.equal(json(c), json({ current: 4, total: 20, capped: true }));
  assert.equal(MAX_COUNTED_MATCHES, 99999);
});

test("works on a lazy iterator, not just arrays", () => {
  function* gen() { for (let i = 0; i < 5; i++) yield { from: i, to: i + 1 }; }
  assert.equal(countMatches(gen(), { from: 2, to: 3 }).current, 3);
});

test("labels", () => {
  const f = (c, v) => json(formatMatchCount(c, v));
  assert.equal(f({ current: 12, total: 345, capped: false }), json({ text: "12/345", state: "found" }));
  assert.equal(f({ current: 0, total: 345, capped: false }), json({ text: "–/345", state: "found" }));
  assert.equal(f({ current: 1234, total: 56789, capped: false }), json({ text: "1,234/56,789", state: "found" }));
  assert.equal(f({ current: 3, total: 99999, capped: true }), json({ text: "3/99,999+", state: "found" }));
  assert.equal(f({ current: 0, total: 0, capped: false }), json({ text: "No matches", state: "none" }));
  assert.equal(f(null), json({ text: "", state: "idle" }));
  assert.equal(f(null, false), json({ text: "Invalid", state: "invalid" }));
});
