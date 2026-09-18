const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const source = fs.readFileSync(path.join(__dirname, 'batch.js'), 'utf8');
const flush = async () => { for (let i = 0; i < 15; i++) await Promise.resolve(); };
const deferred = () => { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; };
function harness() {
  let snapshot, listener, timer, file = 'a.nc';
  const calls = [];
  const fluid = {
    on: (_, cb) => { listener = cb; }, getStatus: async () => ({ state: 'IDLE' }),
    openFile: async p => { file = p; calls.push(['open', p]); },
    getFileStatus: async () => ({ fileName: file, sendState: 'RUNNING' }),
    startSend: async () => calls.push(['start']), stopSend: async () => calls.push(['stop']),
  };
  const context = { window: { Fluid: fluid }, setTimeout, Date,
    setInterval: cb => { timer = cb; return 1; }, clearInterval: () => { timer = null; } };
  vm.runInNewContext(source, context);
  const runner = context.window.BatchRunner;
  runner.init(s => { snapshot = s; }); runner.addFiles(['a.nc', 'b.nc']);
  return { runner, fluid, calls, snapshot: () => snapshot,
    event: state => listener({ state }), tick: () => timer?.() };
}
const complete = { fileName: 'a.nc', sendState: 'COMPLETED', sendRemainingDuration: -1 };
test('Stop during open prevents sending', async () => {
  const h = harness(), d = deferred(); h.fluid.openFile = () => d.promise;
  h.runner.start(); h.runner.stopBatch(); d.resolve(); await flush();
  assert.equal(h.calls.filter(c => c[0] === 'start').length, 0);
});
for (const reject of [false, true]) test(`Stop invalidates pending completion (${reject ? 'reject' : 'resolve'})`, async () => {
  const h = harness(); await flush(); h.runner.start(); await flush();
  const d = deferred(); h.fluid.getFileStatus = () => d.promise;
  h.event('RUN'); h.event('IDLE'); h.runner.stopBatch();
  reject ? d.reject(new Error('offline')) : d.resolve(complete); await flush();
  assert.equal(h.snapshot().batchState, 'stopped');
  assert.equal(h.calls.filter(c => c[0] === 'open').length, 1);
  assert.equal(h.snapshot().queue[0].status, 'stopped');
});
test('canceled stream with zero time and all rows acknowledged never advances', async () => {
  const h = harness(); await flush(); h.runner.start(); await flush();
  h.fluid.getFileStatus = async () => ({ ...complete, sendState: 'CANCELED', sendRemainingDuration: 0, rowCount: 2, completedRowCount: 2 });
  h.tick(); await flush(); assert.equal(h.snapshot().batchState, 'stopped');
  assert.equal(h.calls.filter(c => c[0] === 'open').length, 1);
});
test('short completed job without RUN notification or duration estimate advances only once', async () => {
  const h = harness(); await flush(); h.runner.start(); await flush();
  const d = deferred(); h.fluid.getFileStatus = () => d.promise;
  h.tick(); h.tick(); d.resolve(complete); await flush();
  assert.equal(h.calls.filter(c => c[0] === 'open').length, 2);
  assert.equal(h.snapshot().currentIndex, 1);
  // Release the new file's load check without leaving a retry timer.
  h.fluid.getFileStatus = async () => ({ fileName: 'b.nc', sendState: 'RUNNING' });
});
test('completion waits for controller IDLE and backend completion', async () => {
  const h = harness(); await flush(); h.runner.start(); await flush();
  h.event('RUN'); h.fluid.getFileStatus = async () => complete; h.tick(); await flush();
  assert.equal(h.snapshot().currentIndex, 0);
  h.fluid.getFileStatus = async () => ({ ...complete, sendState: 'RUNNING' });
  h.event('IDLE'); await flush(); assert.equal(h.snapshot().currentIndex, 0);
  h.runner.setAutoAdvance(false); h.fluid.getFileStatus = async () => complete;
  h.tick(); await flush(); assert.equal(h.snapshot().batchState, 'waiting-continue');
});
test('ALARM invalidates pending completion', async () => {
  const h = harness(); await flush(); h.runner.start(); await flush();
  const d = deferred(); h.fluid.getFileStatus = () => d.promise;
  h.tick(); h.event('ALARM'); d.resolve(complete); await flush();
  assert.equal(h.snapshot().queue[0].status, 'error');
  assert.equal(h.calls.filter(c => c[0] === 'open').length, 1);
});
test('picker reserves synchronously before React renders', async () => {
  const source = fs.readFileSync(path.join(__dirname, '../../src/main/webapp-dashboard/src/components/PluginWindow.tsx'), 'utf8');
  const body = source.split('case "pickFile":')[1].split('case "getFileStatus":')[0];
  const reserve = new Function('pickFileRequestRef', 'setPickFileRequest', body);
  const ref = { current: null }; let request;
  const first = reserve(ref, r => { request = r; });
  await assert.rejects(reserve(ref, () => {}), /already open/);
  request.resolve({ path: 'a.nc' }); assert.equal((await first).path, 'a.nc');
});
