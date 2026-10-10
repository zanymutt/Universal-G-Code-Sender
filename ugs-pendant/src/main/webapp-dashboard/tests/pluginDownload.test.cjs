const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const ts = require("typescript");
const vm = require("node:vm");

const source = fs.readFileSync(path.join(__dirname, "../src/utils/pluginDownload.ts"), "utf8");
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText;

// A minimal browser: records the one anchor that gets clicked and every blob URL.
const load = (windowExtras = {}) => {
  const clicked = [];
  const revoked = [];
  const timers = [];
  class FakeBlob {
    constructor(parts, options) {
      this.size = parts.reduce((n, part) => n + Buffer.byteLength(part), 0);
      this.type = options.type;
    }
  }
  const sandbox = {
    exports: {},
    Blob: FakeBlob,
    URL: { createObjectURL: (blob) => `blob:${clicked.length}:${blob.type}`, revokeObjectURL: (url) => revoked.push(url) },
    document: {
      body: { appendChild: () => {} },
      createElement: () => {
        const link = { style: {}, click() { clicked.push({ download: link.download, href: link.href, rel: link.rel }); }, remove() {} };
        return link;
      },
    },
    window: { setTimeout: (fn, ms) => timers.push({ fn, ms }), ...windowExtras },
    Promise,
    Object,
    Error,
    String,
  };
  vm.runInNewContext(compiled, sandbox);
  return { ...sandbox.exports, clicked, revoked, timers };
};

test("a csv is downloaded under its own name with the right type", async () => {
  const { downloadTextFile, clicked } = load();
  const result = await downloadTextFile("thc_log_2026-10-10.csv", "a,b\n1,2\n");
  assert.equal(result.filename, "thc_log_2026-10-10.csv");
  assert.equal(clicked.length, 1);
  assert.equal(clicked[0].download, "thc_log_2026-10-10.csv");
  assert.match(clicked[0].href, /text\/csv$/);
});

test("folder parts and unsafe characters are removed from the name", async () => {
  const { downloadTextFile } = load();
  assert.equal((await downloadTextFile("..\..\evil/dir/log?.CSV", "x")).filename, "log_.CSV");
  assert.equal((await downloadTextFile("  .hidden.txt ", "x")).filename, "hidden.txt");
  assert.equal((await downloadTextFile("a\u0000b:c.json", "{}")).filename, "a_b_c.json");
});

test("only plain-text data extensions are allowed", async () => {
  const { downloadTextFile, clicked } = load();
  for (const name of ["run.exe", "install.bat", "x.html", "x.js", "x.ps1", "noextension", ".csv", "csv", "x.csv.exe"]) {
    await assert.rejects(downloadTextFile(name, "x"), /only saves/, name);
  }
  assert.equal(clicked.length, 0);
});

test("non-string input is rejected before anything is created", async () => {
  const { downloadTextFile, clicked } = load();
  await assert.rejects(downloadTextFile(undefined, "x"), /filename string/);
  await assert.rejects(downloadTextFile("a.csv", { rows: [] }), /content string/);
  assert.equal(clicked.length, 0);
});

test("a file over the size limit is rejected, one at the limit is not", async () => {
  const { downloadTextFile, MAX_DOWNLOAD_BYTES, clicked } = load();
  await assert.rejects(downloadTextFile("big.csv", "a".repeat(MAX_DOWNLOAD_BYTES + 1)), /25 MB/);
  assert.equal(clicked.length, 0);
  await downloadTextFile("ok.csv", "a".repeat(MAX_DOWNLOAD_BYTES));
  assert.equal(clicked.length, 1);
});

test("the object URL is released later, not immediately", async () => {
  const { downloadTextFile, revoked, timers } = load();
  await downloadTextFile("a.txt", "x");
  assert.equal(revoked.length, 0);
  assert.equal(timers.length, 1);
  timers[0].fn();
  assert.equal(revoked.length, 1);
});

// --- Save As dialog (File System Access API) ---------------------------------
const fakePicker = (behaviour) => {
  const calls = [];
  const written = [];
  const picker = async (options) => {
    calls.push(options);
    if (behaviour.throws) throw behaviour.throws;
    return {
      name: behaviour.chosenName || options.suggestedName,
      createWritable: async () => ({ write: async (blob) => written.push(blob), close: async () => {} }),
    };
  };
  return { picker, calls, written };
};

test("with a secure context and a picker, the Save As dialog is used and no download happens", async () => {
  const { picker, calls, written } = fakePicker({ chosenName: "my-log.csv" });
  const { downloadTextFile, clicked } = load({ showSaveFilePicker: picker, isSecureContext: true });
  const result = await downloadTextFile("thc_log.csv", "a,b");
  assert.equal(result.filename, "my-log.csv");
  assert.equal(calls.length, 1);
  assert.equal(calls[0].suggestedName, "thc_log.csv");
  assert.equal(JSON.stringify(calls[0].types[0].accept), JSON.stringify({ "text/csv": [".csv"] }));
  assert.equal(written.length, 1);
  assert.equal(clicked.length, 0);
});

test("closing the Save As dialog rejects as cancelled and does not fall back to a download", async () => {
  const abort = Object.assign(new Error("The user aborted a request."), { name: "AbortError" });
  const { picker } = fakePicker({ throws: abort });
  const { downloadTextFile, clicked } = load({ showSaveFilePicker: picker, isSecureContext: true });
  await assert.rejects(downloadTextFile("a.csv", "x"), /Save cancelled/);
  assert.equal(clicked.length, 0);
});

test("a picker that fails for another reason falls back to the normal download", async () => {
  const blocked = Object.assign(new Error("Must be handling a user gesture"), { name: "SecurityError" });
  const { picker } = fakePicker({ throws: blocked });
  const { downloadTextFile, clicked } = load({ showSaveFilePicker: picker, isSecureContext: true });
  const result = await downloadTextFile("a.csv", "x");
  assert.equal(result.filename, "a.csv");
  assert.equal(clicked.length, 1);
});

test("the picker is not used outside a secure context (plain http on a LAN address)", async () => {
  const { picker, calls } = fakePicker({});
  const { downloadTextFile, clicked } = load({ showSaveFilePicker: picker, isSecureContext: false });
  await downloadTextFile("a.csv", "x");
  assert.equal(calls.length, 0);
  assert.equal(clicked.length, 1);
});
