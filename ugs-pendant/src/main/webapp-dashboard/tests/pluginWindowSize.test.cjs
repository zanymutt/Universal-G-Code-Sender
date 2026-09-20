const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const ts = require("typescript");
const vm = require("node:vm");

const source = fs.readFileSync(path.join(__dirname, "../src/utils/pluginWindowSize.ts"), "utf8");
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText;

const load = (storage) => {
  const sandbox = { exports: {}, window: { localStorage: storage }, JSON, Number, Math };
  vm.runInNewContext(compiled, sandbox);
  return sandbox.exports;
};
const memoryStorage = () => {
  const data = new Map();
  return { getItem: (k) => (data.has(k) ? data.get(k) : null), setItem: (k, v) => data.set(k, v), data };
};

test("a saved size comes back for the same plugin only", () => {
  const storage = memoryStorage();
  const { loadPluginWindowSize, savePluginWindowSize } = load(storage);
  assert.equal(loadPluginWindowSize("nesting"), null);
  savePluginWindowSize("nesting", { width: 640.4, height: 512.6 });
  assert.deepEqual({ ...loadPluginWindowSize("nesting") }, { width: 640, height: 513 });
  assert.equal(loadPluginWindowSize("other"), null);
});
test("absurd or corrupt values are ignored, not restored or saved", () => {
  const storage = memoryStorage();
  const { loadPluginWindowSize, savePluginWindowSize } = load(storage);
  savePluginWindowSize("p", { width: 5, height: 400 });
  savePluginWindowSize("p", { width: NaN, height: 400 });
  assert.equal(storage.data.size, 0);
  storage.setItem("ugs.dashboard.pluginWindowSize.p", "{not json");
  assert.equal(loadPluginWindowSize("p"), null);
  storage.setItem("ugs.dashboard.pluginWindowSize.p", JSON.stringify({ width: 50000, height: 400 }));
  assert.equal(loadPluginWindowSize("p"), null);
});
test("missing or throwing storage just means no remembered size", () => {
  const throwing = { getItem() { throw new Error("blocked"); }, setItem() { throw new Error("blocked"); } };
  const { loadPluginWindowSize, savePluginWindowSize } = load(throwing);
  assert.equal(loadPluginWindowSize("p"), null);
  assert.doesNotThrow(() => savePluginWindowSize("p", { width: 300, height: 300 }));
});
