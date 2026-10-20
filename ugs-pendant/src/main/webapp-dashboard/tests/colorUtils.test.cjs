const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const ts = require("typescript");
const vm = require("node:vm");

const source = fs.readFileSync(path.join(__dirname, "../src/utils/colorUtils.ts"), "utf8");
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
}).outputText;
const sandbox = { exports: {}, Math, Number, String, parseInt };
vm.runInNewContext(compiled, sandbox);
const C = sandbox.exports;

const plain = (value) => JSON.parse(JSON.stringify(value));

test("hex text is normalized or refused", () => {
  assert.equal(C.normalizeHex("#F99E0E"), "#f99e0e");
  assert.equal(C.normalizeHex("f99e0e"), "#f99e0e");
  assert.equal(C.normalizeHex(" #abc "), "#aabbcc");
  assert.equal(C.normalizeHex("#abcd"), null);
  assert.equal(C.normalizeHex("red"), null);
  assert.equal(C.normalizeHex(""), null);
});

test("primary colors have the expected hue", () => {
  assert.deepEqual(plain(C.hexToHsv("#ff0000")), { h: 0, s: 1, v: 1 });
  assert.equal(C.hexToHsv("#00ff00").h, 120);
  assert.equal(C.hexToHsv("#0000ff").h, 240);
  assert.deepEqual(plain(C.hexToHsv("#ffffff")), { h: 0, s: 0, v: 1 });
  assert.deepEqual(plain(C.hexToHsv("#000000")), { h: 0, s: 0, v: 0 });
});

test("a color survives a trip through HSV", () => {
  for (const hex of ["#f99e0e", "#154c2a", "#b41529", "#010001", "#808080", "#3b82f6", "#ffffff", "#000000"]) {
    assert.equal(C.hsvToHex(C.hexToHsv(hex)), hex);
  }
});

test("hue wraps and the square's corners are white, black and the pure hue", () => {
  assert.equal(C.hsvToHex({ h: 360, s: 1, v: 1 }), "#ff0000");
  assert.equal(C.hsvToHex({ h: -120, s: 1, v: 1 }), "#0000ff");
  assert.equal(C.hsvToHex({ h: 200, s: 0, v: 1 }), "#ffffff");
  assert.equal(C.hsvToHex({ h: 200, s: 1, v: 0 }), "#000000");
  assert.equal(C.hueColor(120), "#00ff00");
});

test("a pointer position becomes a clamped fraction of the box", () => {
  const box = { left: 100, top: 50, width: 200, height: 100 };
  assert.deepEqual(plain(C.fractionInBox(200, 100, box)), { x: 0.5, y: 0.5 });
  assert.deepEqual(plain(C.fractionInBox(0, 500, box)), { x: 0, y: 1 });
  assert.deepEqual(plain(C.fractionInBox(900, -5, box)), { x: 1, y: 0 });
  assert.deepEqual(plain(C.fractionInBox(5, 5, { left: 0, top: 0, width: 0, height: 0 })), { x: 0, y: 0 });
});
