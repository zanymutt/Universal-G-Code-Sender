const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

// The online demo (src/demo/demoMachine.ts) simulates the backend's REST API. An
// endpoint the dashboard calls but the demo doesn't handle fails in the demo only
// - once as a blank screen - so this keeps the two in step: add the new path to
// demoMachine.ts, or to NOT_SIMULATED below with a reason.
const NOT_SIMULATED = {
  // Plugins aren't part of the demo; the list endpoint is handled (always empty),
  // and nothing calls a plugin's own files/settings without a listed plugin.
  "/api/v1/plugins/": "plugin routes are built from a listed plugin's id",
};

const srcDir = path.join(__dirname, "../src");
const walk = (dir) =>
  fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return entry.name === "demo" ? [] : walk(full);
    return /\.(ts|tsx)$/.test(entry.name) ? [full] : [];
  });

const used = new Set();
for (const file of walk(srcDir)) {
  for (const match of fs.readFileSync(file, "utf8").matchAll(/\/api\/v1\/[A-Za-z0-9_/]+/g)) used.add(match[0]);
}
const demo = fs.readFileSync(path.join(srcDir, "demo/demoMachine.ts"), "utf8");

test("every API path the dashboard calls is simulated by the demo", () => {
  assert.ok(used.size > 20, "found the dashboard's API calls");
  const missing = [...used].filter(
    (endpoint) => !demo.includes(`case "${endpoint}"`) && !Object.keys(NOT_SIMULATED).some((prefix) => endpoint.startsWith(prefix))
  );
  assert.deepEqual(missing, [], `Add these to src/demo/demoMachine.ts: ${missing.join(", ")}`);
});
