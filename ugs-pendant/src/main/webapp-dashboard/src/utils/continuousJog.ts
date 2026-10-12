// Client side of continuous jogging: turns "these inputs want to go this way"
// into a steady stream of direction updates for the backend.
//
// The backend runs the actual jog (short controller-acknowledged segments, so
// Wi-Fi latency between the dashboard and UGS never stutters the motion) and
// treats every update as a heartbeat: if they stop for half a second it cancels
// the jog by itself. So the rules here are:
//   - re-send the current direction every HEARTBEAT_MS while anything is held;
//   - never have two requests in flight, so a late "go" can't overtake a "stop";
//   - send an explicit zero the moment the last input lets go.
// Pure and timer-injected so it can be tested without a browser.

export type Vec3 = { x: number; y: number; z: number };

export const ZERO: Vec3 = { x: 0, y: 0, z: 0 };
export const HEARTBEAT_MS = 150;

export const isZero = (v: Vec3) => v.x === 0 && v.y === 0 && v.z === 0;
const same = (a: Vec3, b: Vec3) => a.x === b.x && a.y === b.y && a.z === b.z;
const round = (n: number) => Math.round(n * 1000) / 1000;

// Several inputs at once (two held keys, a stick plus a key): sum them, clamp
// each axis to -1..1 and scale a vector longer than 1 back down, so a diagonal
// is not faster than a straight jog (the backend does the same).
export const combineDirections = (vectors: Vec3[]): Vec3 => {
  let x = 0;
  let y = 0;
  let z = 0;
  for (const v of vectors) {
    x += v.x;
    y += v.y;
    z += v.z;
  }
  x = Math.max(-1, Math.min(1, x));
  y = Math.max(-1, Math.min(1, y));
  z = Math.max(-1, Math.min(1, z));
  const length = Math.sqrt(x * x + y * y + z * z);
  if (length > 1) {
    x /= length;
    y /= length;
    z /= length;
  }
  return { x: round(x) || 0, y: round(y) || 0, z: round(z) || 0 };
};

export type SendResult = { active: boolean } | void;

export type ContinuousJogDeps = {
  send: (direction: Vec3) => Promise<SendResult>;
  setInterval: (callback: () => void, ms: number) => unknown;
  clearInterval: (handle: unknown) => void;
  // The backend refused to jog (not connected, a job running, alarm): everything
  // held has been let go, so the owner should forget its own hold state too.
  onRefused?: () => void;
};

export type ContinuousJog = {
  // Set (or, with null, clear) one input's direction. `source` names the input
  // ("ArrowLeft", "gamepad") so inputs can come and go independently.
  set: (source: string, direction: Vec3 | null) => void;
  // Let go of everything and tell the backend to stop (only if it was told to go).
  stopAll: () => void;
  isActive: () => boolean;
};

export const createContinuousJog = (deps: ContinuousJogDeps): ContinuousJog => {
  const sources = new Map<string, Vec3>();
  let desired: Vec3 = ZERO;
  // The backend may be moving: a non-zero direction was sent and a zero hasn't been yet.
  let backendMayBeMoving = false;
  let inFlight = false;
  let stopRetries = 0;
  let timer: unknown = null;

  const stopTimer = () => {
    if (timer !== null) {
      deps.clearInterval(timer);
      timer = null;
    }
  };

  const pump = () => {
    if (inFlight) return;
    const direction = desired;
    const stopping = isZero(direction);
    if (stopping && !backendMayBeMoving) return;

    inFlight = true;
    backendMayBeMoving = !stopping;
    if (!stopping) stopRetries = 0;
    deps
      .send(direction)
      .then((result) => {
        inFlight = false;
        if (!stopping && result && result.active === false) {
          sources.clear();
          desired = ZERO;
          backendMayBeMoving = false;
          stopTimer();
          deps.onRefused?.();
          return;
        }
        // The wanted direction changed while this request was away.
        if (!same(direction, desired)) pump();
      })
      .catch(() => {
        inFlight = false;
        if (stopping && same(direction, desired) && stopRetries < 3) {
          // A "stop" that never arrived is worth repeating at once; the backend's
          // own half-second timeout is only the fallback.
          stopRetries++;
          backendMayBeMoving = true;
          pump();
          return;
        }
        // A lost heartbeat is covered by the next one.
        if (!same(direction, desired)) pump();
      });
  };

  const recompute = () => {
    const next = combineDirections([...sources.values()]);
    if (same(next, desired)) return;
    desired = next;
    if (isZero(desired)) {
      stopTimer();
    } else if (timer === null) {
      timer = deps.setInterval(pump, HEARTBEAT_MS);
    }
    pump();
  };

  return {
    set(source, direction) {
      if (direction === null || isZero(direction)) sources.delete(source);
      else sources.set(source, direction);
      recompute();
    },
    stopAll() {
      sources.clear();
      recompute();
    },
    isActive: () => !isZero(desired),
  };
};
