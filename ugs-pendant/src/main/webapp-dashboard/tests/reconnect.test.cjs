const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const ts = require("typescript");
const vm = require("node:vm");

const source = fs.readFileSync(path.join(__dirname, "../src/utils/reconnect.ts"), "utf8");
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText;
const sandbox = { exports: {}, Math };
vm.runInNewContext(compiled, sandbox);
const { formatOutage, RECONNECT_INTERVAL_MS } = sandbox.exports;

test("outage durations read naturally", () => {
  assert.equal(formatOutage(0), "0 s");
  assert.equal(formatOutage(7.9), "7 s");
  assert.equal(formatOutage(59), "59 s");
  assert.equal(formatOutage(60), "1 min");
  assert.equal(formatOutage(65), "1 min 5 s");
  assert.equal(formatOutage(3600), "1 h");
  assert.equal(formatOutage(3 * 3600 + 120), "3 h 2 min");
});

test("a negative or nonsensical duration never shows a minus sign", () => {
  assert.equal(formatOutage(-5), "0 s");
});

test("retries every four seconds", () => {
  assert.equal(RECONNECT_INTERVAL_MS, 4000);
});
