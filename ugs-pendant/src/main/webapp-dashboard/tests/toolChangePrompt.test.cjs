const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const ts = require("typescript");
const vm = require("node:vm");

const source = fs.readFileSync(path.join(__dirname, "../src/utils/toolChangePrompt.ts"), "utf8");
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
}).outputText;
const sandbox = { exports: {}, Set };
vm.runInNewContext(compiled, sandbox);
const { describeInterceptor, toolChangeStage } = sandbox.exports;
const plain = (value) => JSON.parse(JSON.stringify(value));
const describe = (status) => plain(describeInterceptor(status));

test("nothing is shown while the interceptor is inactive, or unknown", () => {
  assert.equal(describeInterceptor({ state: "INACTIVE" }), null);
  assert.equal(describeInterceptor(null), null);
  assert.equal(describeInterceptor(undefined), null);
});

test("the working states are busy and offer nothing to answer", () => {
  for (const state of ["PENDING", "RUNNING", "RESUMING"]) {
    const view = describe({ state });
    assert.equal(view.busy, true, state);
    assert.deepEqual(view.actions, [], state);
    assert.equal(view.showToolHelpers, false, state);
  }
  assert.equal(describe({ state: "PENDING" }).message, "The machine is finishing the current commands.");
});

test("the change-tool step names the tool asked for, shows the helpers, and offers Abort then Continue", () => {
  const view = describe({
    state: "WAITING_FOR_USER",
    prompt: { stepId: "toolChange.changeTool", options: ["CONTINUE", "ABORT"] },
    toolNumber: 2,
  });
  assert.equal(view.title, "Change tool");
  assert.equal(view.message, "Jog to a place where the tool can be changed, change to tool #2 then zero out Z.");
  assert.equal(view.busy, false);
  assert.equal(view.showToolHelpers, true);
  assert.deepEqual(view.actions.map((a) => [a.response, a.label, a.kind]), [
    ["ABORT", "Abort", "danger"],
    ["CONTINUE", "Continue", "primary"],
  ]);
});

test("tool #0 is a tool; a command that names none says 'the new tool'", () => {
  const base = { state: "WAITING_FOR_USER", prompt: { stepId: "toolChange.changeTool", options: ["CONTINUE"] } };
  assert.match(describe({ ...base, toolNumber: 0 }).message, /change to tool #0 then/);
  assert.match(describe({ ...base, toolNumber: null }).message, /change to the new tool then/);
  assert.match(describe({ ...base }).message, /change to the new tool then/);
});

test("the resume step asks to continue and has no helpers", () => {
  const view = describe({
    state: "WAITING_FOR_USER",
    prompt: { stepId: "toolChange.continue", options: ["CONTINUE", "ABORT"] },
  });
  assert.equal(view.title, "Ready to continue with the job?");
  assert.equal(view.showToolHelpers, false);
  assert.deepEqual(view.actions.map((a) => a.response), ["ABORT", "CONTINUE"]);
});

test("only the answers the step offers appear, in a fixed order, and an unknown step still works", () => {
  const view = describe({
    state: "WAITING_FOR_USER",
    prompt: { stepId: "something.else", options: ["SKIP", "CONTINUE"] },
  });
  assert.equal(view.title, "Action required");
  assert.deepEqual(view.actions.map((a) => a.response), ["SKIP", "CONTINUE"]);
  assert.deepEqual(describe({ state: "WAITING_FOR_USER" }).actions, []);
});

test("a failed tool change leaves only Abort", () => {
  const view = describe({ state: "FAILED" });
  assert.equal(view.title, "Tool change failed");
  assert.equal(view.busy, false);
  assert.deepEqual(view.actions.map((a) => a.response), ["ABORT"]);
});

test("the tool change stage tells the controls outside the prompt what is going on", () => {
  assert.equal(toolChangeStage(null), "none");
  assert.equal(toolChangeStage(undefined), "none");
  assert.equal(toolChangeStage({ state: "INACTIVE" }), "none");
  for (const state of ["PENDING", "RUNNING", "RESUMING"]) assert.equal(toolChangeStage({ state }), "busy");
  // Failed: only Abort is left, so there is nothing to continue.
  assert.equal(toolChangeStage({ state: "FAILED", prompt: { stepId: "x", options: ["ABORT"] } }), "busy");
  // Waiting without a Continue option is not a go-ahead either.
  assert.equal(toolChangeStage({ state: "WAITING_FOR_USER", prompt: { stepId: "x", options: ["ABORT"] } }), "busy");
  assert.equal(toolChangeStage({ state: "WAITING_FOR_USER" }), "busy");
  assert.equal(
    toolChangeStage({ state: "WAITING_FOR_USER", prompt: { stepId: "toolChange.changeTool", options: ["ABORT", "CONTINUE"] } }),
    "continue"
  );
});
