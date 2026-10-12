const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const ts = require("typescript");
const vm = require("node:vm");

const source = fs.readFileSync(path.join(__dirname, "../src/utils/tabNav.ts"), "utf8");
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: "ES2020" } }).outputText;
const sandbox = { exports: {} };
vm.runInNewContext(compiled, sandbox);
const { nextTabIndex } = sandbox.exports;

test("arrows move and wrap", () => {
  assert.equal(nextTabIndex(3, 0, "ArrowRight"), 1);
  assert.equal(nextTabIndex(3, 2, "ArrowRight"), 0);
  assert.equal(nextTabIndex(3, 0, "ArrowLeft"), 2);
  assert.equal(nextTabIndex(3, 1, "ArrowLeft"), 0);
});

test("Home and End jump to the ends", () => {
  assert.equal(nextTabIndex(4, 2, "Home"), 0);
  assert.equal(nextTabIndex(4, 1, "End"), 3);
});

test("other keys and an empty list are not tab navigation", () => {
  assert.equal(nextTabIndex(3, 1, "Enter"), null);
  assert.equal(nextTabIndex(3, 1, "ArrowDown"), null);
  assert.equal(nextTabIndex(0, 0, "ArrowRight"), null);
});
