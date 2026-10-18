// Run with: node tests/jogPresets.test.cjs  (from the webapp-dashboard folder)
// Compiles the TypeScript helper on the fly with the project's TypeScript.
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const ts = require("typescript");

const source = fs.readFileSync(path.join(__dirname, "../src/utils/jogPresets.ts"), "utf8");
const js = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText;
const mod = { exports: {} };
new Function("module", "exports", js)(mod, mod.exports);
const { normalizeJogPresets, sortedPresets, isValidPreset, STEP_SIZE_OPTIONS, FEED_RATE_OPTIONS } = mod.exports;

assert.deepStrictEqual(normalizeJogPresets(null), { xy: STEP_SIZE_OPTIONS, z: STEP_SIZE_OPTIONS, feed: FEED_RATE_OPTIONS });
assert.deepStrictEqual(normalizeJogPresets({ xy: [1, 2, 3, 4, 5, 6] }).xy, [1, 2, 3, 4, 5, 6]);
// bad slots fall back to that slot's default; short rows are filled in
assert.deepStrictEqual(normalizeJogPresets({ feed: [50, -1, "x", 0, null] }).feed, [50, 100, 500, 1000, 2000, 5000]);
assert.deepStrictEqual(sortedPresets([5, 1, 5, 0.5]), [0.5, 1, 5]);
assert.ok(isValidPreset(0.01) && !isValidPreset(0) && !isValidPreset(NaN) && !isValidPreset(Infinity));
console.log("jogPresets ok");
