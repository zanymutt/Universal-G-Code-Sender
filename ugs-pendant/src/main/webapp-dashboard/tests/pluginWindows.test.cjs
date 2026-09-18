const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const ts = require("typescript");
const vm = require("node:vm");
const source = fs.readFileSync(path.join(__dirname, "../src/store/pluginWindows.ts"), "utf8");
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText;
const sandbox = { exports: {} };
vm.runInNewContext(compiled, sandbox);
const { pluginWindowsReducer: reduce, initialPluginWindows: initial } = sandbox.exports;
const plugin = { id: "tool", name: "Tool", entryUrl: "/tool.html" };
const open = (state, p = plugin) => reduce(state, { type: "open", plugin: p });

test("missing/false flag reuses the existing window, including consecutive launches", () => {
  for (const p of [plugin, { ...plugin, allowMultipleInstances: false }]) {
    const first = open(initial, p);
    const second = open(first, p);
    assert.equal(second.windows.length, 1);
    assert.equal(second.windows[0].key, first.windows[0].key);
    assert.equal(second.windows[0].focusRequest, 1);
  }
});
test("relaunch raises the right window without changing DOM order or other instances", () => {
  const a = open(initial);
  const b = open(a, { ...plugin, id: "other" });
  const raised = open(b);
  assert.equal(raised.frontKey, a.frontKey);
  assert.equal(raised.windows[0].key, b.windows[0].key);
  assert.equal(raised.windows[1], b.windows[1]);
});
test("opt-in creates unique keys; closing one preserves its sibling", () => {
  const p = { ...plugin, allowMultipleInstances: true };
  const state = open(open(initial, p), p);
  assert.equal(state.windows.length, 2);
  assert.notEqual(state.windows[0].key, state.windows[1].key);
  const closed = reduce(state, { type: "close", key: state.frontKey });
  assert.equal(closed.windows.length, 1);
  assert.equal(closed.windows[0], state.windows[0]);
  assert.equal(closed.frontKey, state.windows[0].key);
});
test("closed single-instance plugin can reopen with a fresh identity", () => {
  const first = open(initial);
  const reopened = open(reduce(first, { type: "close", key: first.frontKey }));
  assert.notEqual(reopened.frontKey, first.frontKey);
});
test("only literal true opts in; activation preserves window identities", () => {
  const state = open(open(initial), { ...plugin, allowMultipleInstances: "true" });
  assert.equal(state.windows.length, 1);
  const other = open(state, { ...plugin, id: "other" });
  const activated = reduce(other, { type: "activate", key: state.frontKey });
  assert.equal(activated.frontKey, state.frontKey);
  assert.equal(activated.windows, other.windows);
});
