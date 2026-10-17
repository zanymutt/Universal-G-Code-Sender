const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const ts = require("typescript");
const vm = require("node:vm");

// Loads a few src/utils modules into one sandbox, resolving their relative imports.
const modules = {};
const load = (name) => {
  if (modules[name]) return modules[name].exports;
  const source = fs.readFileSync(path.join(__dirname, "../src/utils", `${name}.ts`), "utf8");
  const compiled = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText;
  const module = { exports: {} };
  modules[name] = module;
  const sandbox = {
    module,
    exports: module.exports,
    require: (request) => load(request.replace("./", "")),
    Math,
    Number,
    Object,
    String,
    JSON,
    Float32Array,
    Uint8Array,
    Int32Array,
    Map,
    Set,
    Infinity,
    window: { localStorage: { getItem: () => store.value, setItem: (_k, v) => (store.value = v) } },
  };
  vm.runInNewContext(compiled, sandbox);
  return module.exports;
};
const store = { value: null };
const { sanitizeSavedTools, readStockProfiles, writeStockProfiles, DEFAULT_STOCK_PROFILES } = load("stockSettingsStore");
const BASE = { shape: "flat", diameter: 6, vAngle: 60, cornerRadius: 1, tipDiameter: 0 };
const plain = (value) => JSON.parse(JSON.stringify(value));

test("saved tools keep only well-formed entries, clamped", () => {
  const result = plain(
    sanitizeSavedTools(
      {
        1: { cutter: { shape: "ball", diameter: 9999, vAngle: 60, cornerRadius: 1, tipDiameter: 0 }, color: "#ABCDEF" },
        2: { color: "blue" },
        3: { removed: true },
        4: "nope",
        "-1": { removed: true },
        x: { removed: true },
        100000: { removed: true },
        5: { cutter: { shape: "banana" } },
      },
      BASE
    )
  );
  assert.deepEqual(Object.keys(result).sort(), ["1", "3", "5"]);
  assert.equal(result[1].cutter.diameter, 200);
  assert.equal(result[1].color, "#abcdef");
  assert.deepEqual(result[3], { removed: true });
  assert.equal(result[5].cutter.shape, "flat"); // an unknown shape falls back to the default's
});

test("garbage in place of the table gives an empty one", () => {
  assert.equal(JSON.stringify(sanitizeSavedTools(null, BASE)), "{}");
  assert.equal(JSON.stringify(sanitizeSavedTools("x", BASE)), "{}");
});

test("the table and the color switch round-trip through storage; old saves get the defaults", () => {
  store.value = JSON.stringify({ process: "router", settings: {} });
  const old = readStockProfiles();
  assert.equal(old.colorByTool, true);
  assert.equal(old.warnRapids, true);
  assert.equal(JSON.stringify(old.tools), "{}");

  writeStockProfiles({
    ...DEFAULT_STOCK_PROFILES,
    colorByTool: false,
    warnRapids: false,
    tools: { 2: { removed: true }, 3: { color: "#00ff00" } },
  });
  const back = plain(readStockProfiles());
  assert.equal(back.colorByTool, false);
  assert.equal(back.warnRapids, false);
  assert.deepEqual(back.tools, { 2: { removed: true }, 3: { color: "#00ff00" } });
});
