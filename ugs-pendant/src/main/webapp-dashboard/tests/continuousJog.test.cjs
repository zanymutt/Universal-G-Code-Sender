const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const ts = require("typescript");
const vm = require("node:vm");

const source = fs.readFileSync(path.join(__dirname, "../src/utils/continuousJog.ts"), "utf8");
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: "ES2020" } }).outputText;
const sandbox = { exports: {}, Math, Map, Promise };
vm.runInNewContext(compiled, sandbox);
const { combineDirections, createContinuousJog, HEARTBEAT_MS } = sandbox.exports;
const json = (v) => JSON.stringify(v);

// A fake world: a manual interval timer and a send() whose responses the test controls.
const world = ({ autoResolve = true, result = { active: true } } = {}) => {
  const sent = [];
  const pending = [];
  let tickFn = null;
  let refused = 0;
  const deps = {
    send: (v) =>
      new Promise((resolve, reject) => {
        sent.push(json(v));
        if (autoResolve) resolve(result);
        else pending.push({ resolve, reject });
      }),
    setInterval: (fn) => { tickFn = fn; return 1; },
    clearInterval: () => { tickFn = null; },
    onRefused: () => { refused++; },
  };
  return {
    jog: createContinuousJog(deps),
    sent,
    pending,
    tick: () => tickFn && tickFn(),
    hasTimer: () => tickFn !== null,
    refused: () => refused,
  };
};
const flush = () => new Promise((r) => setImmediate(r));
const X = { x: 1, y: 0, z: 0 };

test("combineDirections sums, clamps and normalises", () => {
  assert.equal(json(combineDirections([])), json({ x: 0, y: 0, z: 0 }));
  assert.equal(json(combineDirections([{ x: -1, y: 0, z: 0 }, { x: 0, y: 1, z: 0 }])), json({ x: -0.707, y: 0.707, z: 0 }));
  assert.equal(json(combineDirections([{ x: 1, y: 0, z: 0 }, { x: 1, y: 0, z: 0 }])), json({ x: 1, y: 0, z: 0 }));
  // opposite keys cancel
  assert.equal(json(combineDirections([{ x: 1, y: 0, z: 0 }, { x: -1, y: 0, z: 0 }])), json({ x: 0, y: 0, z: 0 }));
  // a half deflection stays a half deflection
  assert.equal(json(combineDirections([{ x: 0.5, y: 0, z: 0 }])), json({ x: 0.5, y: 0, z: 0 }));
});

test("holding sends the direction at once and then every heartbeat; letting go sends one stop", async () => {
  const w = world();
  assert.ok(HEARTBEAT_MS <= 250, "must beat the backend's half-second timeout comfortably");
  w.jog.set("ArrowRight", X);
  await flush();
  assert.equal(w.sent.length, 1);
  assert.equal(w.hasTimer(), true);
  assert.equal(w.jog.isActive(), true);

  w.tick(); await flush();
  w.tick(); await flush();
  assert.deepEqual(w.sent, Array(3).fill(json(X)));

  w.jog.set("ArrowRight", null);
  await flush();
  assert.equal(w.sent[3], json({ x: 0, y: 0, z: 0 }));
  assert.equal(w.hasTimer(), false);
  assert.equal(w.jog.isActive(), false);
  assert.equal(w.sent.length, 4);
});

test("stopping when nothing was ever sent sends nothing", async () => {
  const w = world();
  w.jog.stopAll();
  w.jog.set("a", null);
  await flush();
  assert.equal(w.sent.length, 0);
});

test("two held keys combine and releasing one changes direction without stopping", async () => {
  const w = world();
  w.jog.set("ArrowLeft", { x: -1, y: 0, z: 0 });
  await flush();
  w.jog.set("ArrowUp", { x: 0, y: 1, z: 0 });
  await flush();
  w.jog.set("ArrowLeft", null);
  await flush();
  assert.deepEqual(w.sent, [
    json({ x: -1, y: 0, z: 0 }),
    json({ x: -0.707, y: 0.707, z: 0 }),
    json({ x: 0, y: 1, z: 0 }),
  ]);
  assert.equal(w.hasTimer(), true);
});

test("only one request is ever in flight, so a late go cannot overtake the stop", async () => {
  const w = world({ autoResolve: false });
  w.jog.set("k", X);
  assert.equal(w.sent.length, 1);
  w.tick(); w.tick(); // heartbeats while the first is still away
  assert.equal(w.sent.length, 1);
  w.jog.set("k", null); // released while it's still away
  assert.equal(w.sent.length, 1);

  w.pending[0].resolve({ active: true });
  await flush();
  // Now, and only now, the stop goes out.
  assert.equal(w.sent.length, 2);
  assert.equal(w.sent[1], json({ x: 0, y: 0, z: 0 }));
});

test("a stop that fails is retried a few times", async () => {
  const w = world({ autoResolve: false });
  w.jog.set("k", X);
  w.pending.shift().resolve({ active: true });
  await flush();
  w.jog.set("k", null);
  assert.equal(w.sent.length, 2);
  for (let i = 0; i < 3; i++) {
    w.pending.shift().reject(new Error("net"));
    await flush();
  }
  assert.equal(w.sent.length, 5); // the stop + 3 retries
  w.pending.shift().reject(new Error("net"));
  await flush();
  assert.equal(w.sent.length, 5); // gives up; the backend's own timeout takes over
});

test("a refusal lets go of everything, stops the heartbeat and says so", async () => {
  const w = world({ result: { active: false } });
  w.jog.set("a", X);
  w.jog.set("b", { x: 0, y: 1, z: 0 });
  await flush();
  assert.equal(w.refused(), 1);
  assert.equal(w.jog.isActive(), false);
  assert.equal(w.hasTimer(), false);
  // And it does not follow up with a stop for something that never moved.
  const count = w.sent.length;
  w.jog.stopAll();
  await flush();
  assert.equal(w.sent.length, count);
});

test("a lost heartbeat does not stop the jog", async () => {
  const w = world({ autoResolve: false });
  w.jog.set("k", X);
  w.pending.shift().reject(new Error("net"));
  await flush();
  assert.equal(w.jog.isActive(), true);
  assert.equal(w.hasTimer(), true);
  w.tick();
  assert.equal(w.sent.length, 2);
});
