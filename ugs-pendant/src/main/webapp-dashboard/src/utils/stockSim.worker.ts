// Runs the stock-removal heightfield off the UI thread (see stockSimEngine.ts).
// The page sends a job once and then just says "show me the state after N
// segments (and this far into the next one)"; the worker only ever works toward
// the newest such request, so a scrub slider or fast playback can't build up a
// backlog.
import { PackedToolpath, planStockGrid, StockGrid, StockSettings, StockSimulator } from "./stockSimEngine";

export type StockWorkerRequest =
  | { type: "load"; jobId: number; packed: PackedToolpath; settings: StockSettings }
  | { type: "seek"; jobId: number; index: number; fraction: number };

export type StockWorkerResponse =
  | { type: "empty"; jobId: number }
  // toolNumbers[n] is the tool recorded as slot n + 1 in a "heights" owner map.
  | { type: "ready"; jobId: number; grid: StockGrid; segmentCount: number; toolNumbers: number[] }
  // owner is null when the file cuts with fewer than two tools. rapidHits: the
  // rapid moves so far that cut into material (segment indices, first few).
  | {
      type: "heights";
      jobId: number;
      index: number;
      heights: Float32Array;
      owner: Uint8Array | null;
      rapidHits: { count: number; first: number[] };
      done: boolean;
    }
  | { type: "progress"; jobId: number; index: number; target: number };

type WorkerScope = {
  postMessage(message: StockWorkerResponse, transfer?: Transferable[]): void;
  onmessage: ((event: MessageEvent<StockWorkerRequest>) => void) | null;
};
const scope = self as unknown as WorkerScope;

// How long one stretch of stamping may run before the worker looks at its
// inbox again, and how often a half-built result is shown while a long
// forward pass is under way.
const SLICE_MS = 25;
const PARTIAL_EVERY_MS = 400;
// Segments stamped between clock checks.
const BATCH = 64;

let jobId = -1;
let simulator: StockSimulator | null = null;
let targetIndex = 0;
// How far into segment `targetIndex` the cut is (0..1).
let targetFraction = 0;
let pumping = false;

const postHeights = (index: number, done: boolean) => {
  if (!simulator) return;
  const copy = new Float32Array(simulator.getHeights());
  const owner = simulator.getOwner();
  const ownerCopy = owner ? new Uint8Array(owner) : null;
  scope.postMessage(
    { type: "heights", jobId, index, heights: copy, owner: ownerCopy, rapidHits: simulator.getRapidHits(), done },
    ownerCopy ? [copy.buffer, ownerCopy.buffer] : [copy.buffer]
  );
};

const yieldToInbox = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

const pump = async () => {
  if (pumping) return;
  pumping = true;
  try {
    let lastPartial = performance.now();
    while (simulator) {
      const sim = simulator;
      const id = jobId;
      const wantIndex = targetIndex;
      const wantFraction = targetFraction;
      const sliceEnd = performance.now() + SLICE_MS;

      // Backward moves are one restore plus a bounded re-stamp; forward ones
      // are walked in slices so a huge file stays interruptible.
      let reached = sim.getIndex() >= wantIndex;
      if (!reached) {
        let next = sim.getIndex();
        while (next < wantIndex && performance.now() < sliceEnd) {
          next = Math.min(wantIndex, next + BATCH);
          sim.seek(next);
        }
        reached = next >= wantIndex;
      }
      if (reached) {
        sim.seek(wantIndex, wantFraction);
        // A newer request may have landed only while yielding, never inside
        // this synchronous stretch, so what was just built is what was asked.
        postHeights(wantIndex, true);
        break;
      }

      const now = performance.now();
      if (now - lastPartial > PARTIAL_EVERY_MS) {
        lastPartial = now;
        postHeights(sim.getIndex(), false);
      }
      scope.postMessage({ type: "progress", jobId: id, index: sim.getIndex(), target: wantIndex });
      await yieldToInbox();
      // A new job replaced this one while yielding.
      if (simulator !== sim) break;
    }
  } finally {
    pumping = false;
  }
};

scope.onmessage = (event) => {
  const message = event.data;
  if (message.type === "load") {
    jobId = message.jobId;
    simulator = null;
    targetIndex = 0;
    targetFraction = 0;
    const grid = planStockGrid(message.packed, message.settings);
    if (!grid) {
      scope.postMessage({ type: "empty", jobId });
      return;
    }
    simulator = new StockSimulator(message.packed, message.settings, grid);
    scope.postMessage({
      type: "ready",
      jobId,
      grid,
      segmentCount: simulator.segmentCount,
      toolNumbers: simulator.toolNumbers,
    });
    return;
  }
  if (message.type === "seek" && message.jobId === jobId && simulator) {
    targetIndex = Math.max(0, Math.min(simulator.segmentCount, Math.floor(message.index)));
    targetFraction = Math.max(0, Math.min(1, message.fraction));
    void pump();
  }
};
