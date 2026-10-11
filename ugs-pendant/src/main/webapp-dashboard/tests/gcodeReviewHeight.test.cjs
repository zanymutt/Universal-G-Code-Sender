const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const ts = require("typescript");
const vm = require("node:vm");

const source = fs.readFileSync(path.join(__dirname, "../src/utils/gcodeReviewHeight.ts"), "utf8");
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText;
const load = (storage) => {
  const sandbox = { exports: {}, localStorage: storage, Number, Math };
  vm.runInNewContext(compiled, sandbox);
  return sandbox.exports;
};
const memory = () => {
  const data = new Map();
  return {
    getItem: (k) => (data.has(k) ? data.get(k) : null),
    setItem: (k, v) => void data.set(k, String(v)),
    removeItem: (k) => void data.delete(k),
    data,
  };
};

test("clamp keeps the panel at least its minimum and leaves room for the code", () => {
  const { clampReviewHeight } = load(memory());
  assert.equal(clampReviewHeight(10, 400), 96);
  assert.equal(clampReviewHeight(150, 400), 150);
  assert.equal(clampReviewHeight(9999, 400), 260); // 400 - 140 reserved
  assert.equal(clampReviewHeight(150.4, 400), 150);
});

test("a container too short for both still honours the minimum", () => {
  const { clampReviewHeight } = load(memory());
  assert.equal(clampReviewHeight(300, 150), 96);
});

test("height round-trips through storage and null clears it", () => {
  const storage = memory();
  const api = load(storage);
  assert.equal(api.loadReviewHeight(), null);
  api.saveReviewHeight(212.6);
  assert.equal(load(storage).loadReviewHeight(), 213);
  api.saveReviewHeight(null);
  assert.equal(load(storage).loadReviewHeight(), null);
});

test("bad stored values and storage failures read as automatic", () => {
  for (const bad of ["abc", "12", "-5", "Infinity", ""]) {
    const storage = memory();
    storage.setItem("ugs-dashboard-gcode-review-height", bad);
    assert.equal(load(storage).loadReviewHeight(), null, JSON.stringify(bad));
  }
  const broken = { getItem() { throw new Error("denied"); }, setItem() { throw new Error("denied"); }, removeItem() { throw new Error("denied"); } };
  const api = load(broken);
  assert.equal(api.loadReviewHeight(), null);
  assert.doesNotThrow(() => api.saveReviewHeight(200));
  assert.doesNotThrow(() => api.saveReviewHeight(null));
});
