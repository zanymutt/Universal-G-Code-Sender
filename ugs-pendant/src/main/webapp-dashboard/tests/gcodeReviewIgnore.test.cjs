const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const ts = require("typescript");
const vm = require("node:vm");

const source = fs.readFileSync(path.join(__dirname, "../src/utils/gcodeReviewIgnore.ts"), "utf8");
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText;

const makeSandbox = (storage) => {
  const sandbox = { exports: {}, localStorage: storage, JSON, Array };
  vm.runInNewContext(compiled, sandbox);
  return sandbox.exports;
};
const memoryStorage = () => {
  const data = new Map();
  return {
    getItem: (k) => (data.has(k) ? data.get(k) : null),
    setItem: (k, v) => void data.set(k, String(v)),
    data,
  };
};
// The module runs in a vm context, so compare via JSON rather than deepEqual.
const json = (v) => JSON.stringify(v);

const error = { lineNumber: 11, severity: "ERROR", message: "Malformed numeric word 'if5399'.", source: "o100 if [#5399 EQ 0]" };
const sameMessageElsewhere = { ...error, lineNumber: 40, source: "o200 if [#5399 EQ 0]" };
const warning = { lineNumber: 9, severity: "WARNING", message: "Unknown M-code 'M66'. The controller may support it.", source: "M66 P0 L0" };

test("a finding is keyed by severity and message, not line or source text", () => {
  const { findingKey } = makeSandbox(memoryStorage());
  assert.equal(findingKey(error), findingKey(sameMessageElsewhere));
  assert.notEqual(findingKey(error), findingKey(warning));
  assert.notEqual(findingKey(error), findingKey({ ...error, severity: "WARNING" }));
});

test("ignoring one finding hides every occurrence of it and nothing else", () => {
  const { findingKey, splitIgnored } = makeSandbox(memoryStorage());
  const { active, hidden } = splitIgnored([error, warning, sameMessageElsewhere], new Set([findingKey(error)]));
  assert.equal(json(active.map((f) => f.lineNumber)), json([9]));
  assert.equal(json(hidden.map((f) => f.lineNumber)), json([11, 40]));
});

test("with nothing ignored every finding stays active, in order", () => {
  const { splitIgnored } = makeSandbox(memoryStorage());
  const { active, hidden } = splitIgnored([warning, error], new Set());
  assert.equal(active.length, 2);
  assert.equal(hidden.length, 0);
  assert.equal(active[0].lineNumber, 9);
});

test("ignored findings persist and reload", () => {
  const storage = memoryStorage();
  const api = makeSandbox(storage);
  api.saveIgnoredFindings(["ERROR|a", "WARNING|b"]);
  assert.equal(json(makeSandbox(storage).loadIgnoredFindings()), json(["ERROR|a", "WARNING|b"]));
});

test("corrupt or hostile stored data loads as an empty list", () => {
  for (const bad of ["not json", "{\"a\":1}", "null", "[1,2,{}]"]) {
    const storage = memoryStorage();
    storage.setItem("ugs-dashboard-gcode-review-ignored", bad);
    const loaded = makeSandbox(storage).loadIgnoredFindings();
    assert.ok(loaded.every((item) => typeof item === "string"), bad);
  }
  const storage = memoryStorage();
  storage.setItem("ugs-dashboard-gcode-review-ignored", "not json");
  assert.equal(makeSandbox(storage).loadIgnoredFindings().length, 0);
});

test("the stored list is capped, keeping the newest", () => {
  const storage = memoryStorage();
  const api = makeSandbox(storage);
  const many = Array.from({ length: 450 }, (_, i) => `ERROR|m${i}`);
  api.saveIgnoredFindings(many);
  const loaded = api.loadIgnoredFindings();
  assert.equal(loaded.length, 300);
  assert.equal(loaded[299], "ERROR|m449");
  assert.equal(loaded[0], "ERROR|m150");
});

test("storage failures never throw", () => {
  const broken = { getItem() { throw new Error("denied"); }, setItem() { throw new Error("denied"); } };
  const api = makeSandbox(broken);
  assert.equal(api.loadIgnoredFindings().length, 0);
  assert.doesNotThrow(() => api.saveIgnoredFindings(["ERROR|a"]));
});
