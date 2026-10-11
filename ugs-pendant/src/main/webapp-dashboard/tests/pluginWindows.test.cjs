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
test("minimize keeps the window mounted, hands the front to a visible sibling, restore raises it", () => {
  const a = open(initial);
  const b = open(a, { ...plugin, id: "other" });
  const min = reduce(b, { type: "minimize", key: b.frontKey });
  assert.equal(min.windows.length, 2);
  assert.equal(min.windows[1].minimized, true);
  assert.equal(min.windows[0], b.windows[0]);
  assert.equal(min.frontKey, a.frontKey);
  const restored = reduce(min, { type: "restore", key: b.frontKey });
  assert.equal(restored.windows[1].minimized, false);
  assert.equal(restored.windows[1].focusRequest, 1);
  assert.equal(restored.frontKey, b.frontKey);
});
test("minimizing the only window leaves no front window; redundant minimize/restore are no-ops", () => {
  const a = open(initial);
  const min = reduce(a, { type: "minimize", key: a.frontKey });
  assert.equal(min.frontKey, null);
  assert.equal(reduce(min, { type: "minimize", key: a.windows[0].key }), min);
  assert.equal(reduce(a, { type: "restore", key: a.frontKey }), a);
});
test("relaunching a minimized plugin restores it instead of opening a second window", () => {
  const min = reduce(open(initial), { type: "minimize", key: 0 });
  const again = open(min);
  assert.equal(again.windows.length, 1);
  assert.equal(again.windows[0].minimized, false);
  assert.equal(again.frontKey, 0);
});
test("a minimized window can't be activated; closing the front skips minimized siblings", () => {
  const a = open(initial);
  const b = open(a, { ...plugin, id: "other" });
  const c = open(b, { ...plugin, id: "third" });
  const min = reduce(c, { type: "minimize", key: b.frontKey });
  assert.equal(reduce(min, { type: "activate", key: b.frontKey }), min);
  const closed = reduce(min, { type: "close", key: c.frontKey });
  assert.equal(closed.frontKey, a.frontKey);
});

test("windows open floating; dock records the slot without touching DOM order", () => {
  const a = open(initial);
  const b = open(a, { ...plugin, id: "other" });
  assert.equal(b.windows[0].dockSlot, null);
  const docked = reduce(b, { type: "dock", key: b.windows[0].key, slot: "pane-1" });
  assert.equal(docked.windows[0].dockSlot, "pane-1");
  assert.equal(docked.windows[0].minimized, false);
  // JSON compare: the reducer runs in a vm context, so its arrays have a
  // different prototype and strict deepEqual rejects them.
  assert.equal(JSON.stringify(docked.windows.map(w => w.key)), JSON.stringify(b.windows.map(w => w.key)));
  assert.equal(docked.windows[1], b.windows[1]);
});
test("docking over an occupied slot parks the previous plugin (minimized, still open), not closes it", () => {
  const a = open(initial);
  const b = open(a, { ...plugin, id: "other" });
  const first = reduce(b, { type: "dock", key: b.windows[0].key, slot: "pane-1" });
  const second = reduce(first, { type: "dock", key: b.windows[1].key, slot: "pane-1" });
  assert.equal(second.windows.length, 2);
  assert.equal(second.windows[1].dockSlot, "pane-1");
  assert.equal(second.windows[0].dockSlot, null);
  assert.equal(second.windows[0].minimized, true);
  assert.equal(second.frontKey, b.windows[1].key);
});
test("plugins in different slots coexist", () => {
  const a = open(initial);
  const b = open(a, { ...plugin, id: "other" });
  const s = reduce(reduce(b, { type: "dock", key: b.windows[0].key, slot: "pane-1" }),
    { type: "dock", key: b.windows[1].key, slot: "pane-2" });
  assert.equal(JSON.stringify(s.windows.map(w => [w.dockSlot, w.minimized])), JSON.stringify([["pane-1", false], ["pane-2", false]]));
});
test("float returns a docked window to floating and raises it; relaunch keeps it docked", () => {
  const a = open(initial);
  const docked = reduce(a, { type: "dock", key: a.windows[0].key, slot: "pane-1" });
  const relaunched = open(docked);
  assert.equal(relaunched.windows[0].dockSlot, "pane-1");
  const floated = reduce(docked, { type: "float", key: a.windows[0].key });
  assert.equal(floated.windows[0].dockSlot, null);
  assert.equal(floated.frontKey, a.windows[0].key);
  assert.equal(reduce(floated, { type: "float", key: a.windows[0].key }), floated);
});
test("a parked plugin restored from the tray comes back floating", () => {
  const a = open(initial);
  const b = open(a, { ...plugin, id: "other" });
  const s = reduce(reduce(b, { type: "dock", key: b.windows[0].key, slot: "pane-1" }),
    { type: "dock", key: b.windows[1].key, slot: "pane-1" });
  const restored = reduce(s, { type: "restore", key: b.windows[0].key });
  assert.equal(restored.windows[0].dockSlot, null);
  assert.equal(restored.windows[0].minimized, false);
});

test("openDocked creates a window already docked, and reuses an existing one wherever it is", () => {
  const created = reduce(initial, { type: "openDocked", plugin, slot: "pane-1" });
  assert.equal(created.windows.length, 1);
  assert.equal(created.windows[0].dockSlot, "pane-1");
  assert.equal(created.windows[0].minimized, false);
  // already there: no change at all (what keeps the reconcile effect from looping)
  assert.equal(reduce(created, { type: "openDocked", plugin, slot: "pane-1" }), created);
  // floating elsewhere: the same window is docked, not duplicated
  const floating = open(initial);
  const moved = reduce(floating, { type: "openDocked", plugin, slot: "pane-2" });
  assert.equal(moved.windows.length, 1);
  assert.equal(moved.windows[0].key, floating.windows[0].key);
  assert.equal(moved.windows[0].dockSlot, "pane-2");
});
test("openDocked over an occupied slot parks the occupant", () => {
  const a = reduce(initial, { type: "openDocked", plugin, slot: "pane-1" });
  const b = reduce(a, { type: "openDocked", plugin: { ...plugin, id: "other" }, slot: "pane-1" });
  assert.equal(b.windows.length, 2);
  assert.equal(b.windows[0].dockSlot, null);
  assert.equal(b.windows[0].minimized, true);
  assert.equal(b.windows[1].dockSlot, "pane-1");
});
test("a multi-instance plugin gets a new window per slot instead of pulling a floating one", () => {
  const p = { ...plugin, allowMultipleInstances: true };
  const floating = open(initial, p);
  const docked = reduce(floating, { type: "openDocked", plugin: p, slot: "pane-1" });
  assert.equal(docked.windows.length, 2);
  assert.equal(docked.windows[0].dockSlot, null);
  assert.equal(docked.windows[1].dockSlot, "pane-1");
});
test("park hides a docked window without closing it, and is a no-op when already parked", () => {
  const docked = reduce(initial, { type: "openDocked", plugin, slot: "pane-1" });
  const parked = reduce(docked, { type: "park", key: docked.windows[0].key });
  assert.equal(parked.windows.length, 1);
  assert.equal(parked.windows[0].dockSlot, null);
  assert.equal(parked.windows[0].minimized, true);
  assert.equal(parked.frontKey, null);
  assert.equal(reduce(parked, { type: "park", key: docked.windows[0].key }), parked);
});
