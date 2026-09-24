// The simulated machine behind the online demo: an in-memory stand-in for the
// UGS backend (REST resources + the events WebSocket), so the dashboard can run
// on a static host like GitHub Pages. Everything lives in this module's memory -
// nothing is sent anywhere or saved, and a page reload starts over.
//
// It models a small 3-axis GRBL machine: jogging, MDI/console commands, macros,
// work-coordinate zeroing, spindle/coolant/overrides, and running the loaded
// program (start/pause/resume/stop, "run from line") with the position moving
// along the toolpath at the programmed feed rates.

import { Command, Effect, Program, Vec, parseGcode, toolpathFrom } from "./gcodeProgram";
import { reviewGcode } from "./gcodeReview";
import { DEFAULT_FILE, SAMPLE_FILES } from "./samples";

type Listener = (message: unknown) => void;

export type DemoResponse = { status: number; body: string; contentType: string };

const RAPID_MM_PER_MIN = 3000;
const TICK_MS = 40;
const STATUS_MS = 250;
const PROGRESS_EVENT_MS = 100;
const HOME_MACHINE: Vec = { x: 0, y: 0, z: 0 };

// --- state ---------------------------------------------------------------

const settings = {
  jogFeedRate: 3000,
  jogStepSizeXY: 1,
  preferredUnits: "MM",
  jogStepSizeZ: 1,
  port: "Demo machine",
  portRate: "115200",
  firmwareVersion: "GRBL",
  useZStepSize: true,
  workspaceDirectory: "Online demo (nothing is saved)",
};

const status: Record<string, any> = {
  machineCoord: { x: 0, y: 0, z: 0, a: null, b: null, c: null, units: "MM" },
  workCoord: { x: 0, y: 0, z: 0, a: null, b: null, c: null, units: "MM" },
  feedSpeed: 0,
  spindleSpeed: 0,
  accessoryStates: { spindleCW: false, flood: false, mist: false },
  overrides: { feed: 100, rapid: 100, spindle: 100 },
  floodCoolantOn: false,
  motionMode: "G0",
  coordinateSystem: "G54",
  plane: "G17",
  distanceMode: "G90",
  feedMode: "G94",
  units: "G21",
  spindleMode: "M5",
  toolNumber: 0,
  state: "IDLE",
  pins: {
    x: false, y: false, z: false, a: false, b: false, c: false,
    probe: false, door: false, hold: false, softReset: false, cycleStart: false,
  },
};

// Where the tool is, in machine coordinates. Work coordinates are this minus the
// active work-coordinate system's offset.
const machine: Vec = { x: 120, y: 80, z: -30 };
const wcsOffsets: Record<string, Vec> = {
  G54: { x: 120, y: 80, z: -40 },
  G55: { x: 0, y: 0, z: 0 },
  G56: { x: 0, y: 0, z: 0 },
  G57: { x: 0, y: 0, z: 0 },
  G58: { x: 0, y: 0, z: 0 },
  G59: { x: 0, y: 0, z: 0 },
};
let spindleProgrammedSpeed = 0;

const probeSettings = {
  feedRateFast: 100,
  feedRateSlow: 10,
  retractDistance: 3,
  delayAfterRetract: 1,
  probeDiameter: 3.175,
  plateThickness: 15,
  maxTravel: 25,
  compensateSoftLimits: true,
};

const macros: any[] = [
  { uuid: "m1", name: "Home", description: "Home all axes", gcode: "$H", color: "#4ade80", icon: "home" },
  { uuid: "m2", name: "Zero XY", description: "Zero X/Y work offset", gcode: "G10 L20 P1 X0 Y0", color: "#60a5fa", icon: "crosshairs" },
  { uuid: "m3", name: "Spindle On", description: undefined, gcode: "M3 S1000" },
];

const files: Record<string, string> = { ...SAMPLE_FILES };
const fileTimes: Record<string, number> = {};
const extraFolders = new Set<string>();
Object.keys(files).forEach((path, i) => (fileTimes[path] = Date.now() - i * 17 * 60 * 1000));

// Plugin settings live here for the page's lifetime, like everything else.
const pluginSettings: Record<string, unknown> = {};

let activeFile = "";
let program: Program = { commands: [], segments: [] };
let armedLine = 0;

const fileStatus = {
  sendState: "IDLE" as string,
  fileName: "",
  rowCount: 0,
  completedRowCount: 0,
  remainingRowCount: 0,
  sendDuration: 0,
  sendRemainingDuration: 0,
  lastCompletedLineNumber: -1,
};

// --- events ----------------------------------------------------------------

const listeners = new Set<Listener>();
let statusTimer: number | undefined;
let statusTick = 0;

const emit = (message: unknown) => listeners.forEach((listener) => listener(message));

const commandEvent = (commandEventType: string, command: string, response = "", ok = false) =>
  emit({
    eventType: "CommandEvent",
    event: { commandEventType, command: { command, response, isError: false, isOk: ok } },
  });

const syncCoordinates = () => {
  const offset = wcsOffsets[status.coordinateSystem] ?? wcsOffsets.G54;
  Object.assign(status.machineCoord, { x: machine.x, y: machine.y, z: machine.z });
  Object.assign(status.workCoord, { x: machine.x - offset.x, y: machine.y - offset.y, z: machine.z - offset.z });
};

const statusJson = () => {
  syncCoordinates();
  return JSON.stringify(status);
};

export const getWorkPosition = (): Vec => {
  syncCoordinates();
  return { x: status.workCoord.x, y: status.workCoord.y, z: status.workCoord.z };
};

const broadcastStatus = () => {
  const snapshot = JSON.parse(statusJson());
  emit({ eventType: "ControllerStatusEvent", event: { status: snapshot, previousStatus: snapshot } });
};

const isBusy = () => status.state !== "IDLE" && status.state !== "DISCONNECTED";

// Idle machines report less often, like a real controller that's gone quiet;
// while anything is moving the DRO updates at 4 Hz.
const statusTimerTick = () => {
  statusTick++;
  if (isBusy() || statusTick % 2 === 0) broadcastStatus();
};

export const subscribe = (listener: Listener): (() => void) => {
  listeners.add(listener);
  if (statusTimer === undefined) statusTimer = window.setInterval(statusTimerTick, STATUS_MS);
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0 && statusTimer !== undefined) {
      window.clearInterval(statusTimer);
      statusTimer = undefined;
    }
  };
};

export const verboseLine = () => {
  syncCoordinates();
  const { x, y, z } = status.machineCoord;
  return `<${status.state}|MPos:${x.toFixed(3)},${y.toFixed(3)},${z.toFixed(3)}|FS:${Math.round(status.feedSpeed)},${Math.round(status.spindleSpeed)}>`;
};

// --- effects of parsed commands ---------------------------------------------

const applySpindleSpeed = () => {
  if (status.accessoryStates.spindleCW) {
    status.spindleSpeed = Math.round((spindleProgrammedSpeed * status.overrides.spindle) / 100);
  }
};

const applyEffect = (effect: Effect) => {
  switch (effect.kind) {
    case "spindle":
      status.spindleMode = effect.mode;
      status.accessoryStates.spindleCW = effect.mode !== "M5";
      status.spindleSpeed = effect.mode === "M5" ? 0 : Math.round((spindleProgrammedSpeed * status.overrides.spindle) / 100);
      break;
    case "spindleSpeed":
      spindleProgrammedSpeed = effect.value;
      applySpindleSpeed();
      break;
    case "coolant":
      status.floodCoolantOn = effect.mode === "M8";
      status.accessoryStates.flood = effect.mode === "M8";
      status.accessoryStates.mist = effect.mode === "M7";
      break;
    case "modal":
      status[effect.field] = effect.value;
      break;
  }
};

// --- motion --------------------------------------------------------------------

type Activity = "idle" | "jog" | "mdi" | "job" | "home";

type Motion = {
  // Work coordinates to move to, or null for a command with no movement
  // (spindle, dwell...). `machineTarget` is the same in machine coordinates,
  // resolved when the motion starts so a WCS change earlier in a program applies.
  target: Vec | null;
  machineTarget?: Vec;
  rapid: boolean;
  feed: number;
  overridable: boolean;
  dwell: number;
  line: number;
  lastOfLine: boolean;
  effect?: () => void;
  started?: boolean;
  done?: () => void;
};

let queue: Motion[] = [];
let activity: Activity = "idle";
let paused = false;
let tickTimer: number | undefined;
let lastTick = 0;
let lastProgressEvent = 0;
let job: { totalSeconds: number; elapsed: number; streamRows: number; completedRows: number } | null = null;
let onFinished: Array<() => void> = [];

const toMachine = (work: Vec): Vec => {
  const offset = wcsOffsets[status.coordinateSystem] ?? wcsOffsets.G54;
  return { x: work.x + offset.x, y: work.y + offset.y, z: work.z + offset.z };
};

const motionSpeed = (motion: Motion): number => {
  // mm per second
  if (motion.rapid) return ((RAPID_MM_PER_MIN * (motion.overridable ? status.overrides.rapid : 100)) / 100) / 60;
  const feed = motion.feed > 0 ? motion.feed : 1000;
  return ((feed * (motion.overridable ? status.overrides.feed : 100)) / 100) / 60;
};

const estimateSeconds = (motions: Motion[], from: Vec): number => {
  let seconds = 0;
  let at = { ...from };
  for (const motion of motions) {
    if (motion.target) {
      const distance = Math.hypot(motion.target.x - at.x, motion.target.y - at.y, motion.target.z - at.z);
      seconds += distance / (motionSpeed({ ...motion, overridable: false }) || 1);
      at = motion.target;
    }
    seconds += motion.dwell;
  }
  return seconds;
};

const stateName = () => {
  if (status.state === "DISCONNECTED") return "DISCONNECTED";
  if (activity === "idle") return "IDLE";
  if (paused) return "HOLD";
  return { jog: "JOG", mdi: "RUN", job: "RUN", home: "HOME", idle: "IDLE" }[activity];
};

const updateState = () => {
  status.state = stateName();
  const active = activity !== "idle" && !paused;
  if (!active) status.feedSpeed = 0;
};

const finishActivity = () => {
  const finishedKind = activity;
  activity = "idle";
  paused = false;
  status.feedSpeed = 0;
  if (finishedKind === "job" && job) {
    fileStatus.sendState = "COMPLETED";
    fileStatus.completedRowCount = job.streamRows;
    fileStatus.remainingRowCount = 0;
    fileStatus.sendRemainingDuration = 0;
    job = null;
  }
  updateState();
  broadcastStatus();
  const callbacks = onFinished;
  onFinished = [];
  callbacks.forEach((callback) => callback());
  // One last file-status refetch so the progress bar and editor land on the final state.
  if (finishedKind === "job") commandEvent("COMMAND_SKIPPED", "");
};

const completeLine = (line: number) => {
  if (!job) return;
  job.completedRows++;
  fileStatus.completedRowCount = job.completedRows;
  fileStatus.remainingRowCount = Math.max(0, job.streamRows - job.completedRows);
  fileStatus.lastCompletedLineNumber = line;
  const now = performance.now();
  if (now - lastProgressEvent >= PROGRESS_EVENT_MS) {
    lastProgressEvent = now;
    // Any CommandEvent makes the dashboard refetch the file status, which is
    // what moves the editor's running-line highlight and the progress bar.
    commandEvent("COMMAND_SKIPPED", "");
  }
};

const tick = () => {
  const now = performance.now();
  const dt = Math.min(0.25, (now - lastTick) / 1000);
  lastTick = now;
  if (paused || queue.length === 0) return;

  let budget = dt;
  if (job) {
    job.elapsed += dt;
    fileStatus.sendDuration = Math.round(job.elapsed * 1000);
    fileStatus.sendRemainingDuration = Math.max(0, Math.round((job.totalSeconds - job.elapsed) * 1000));
  }

  while (budget > 1e-9 && queue.length > 0) {
    const motion = queue[0];
    if (!motion.started) {
      motion.started = true;
      motion.effect?.();
      if (motion.target) motion.machineTarget = toMachine(motion.target);
      status.feedSpeed = motion.rapid ? RAPID_MM_PER_MIN : Math.round((motion.feed * (motion.overridable ? status.overrides.feed : 100)) / 100);
    }

    if (motion.machineTarget) {
      const dx = motion.machineTarget.x - machine.x;
      const dy = motion.machineTarget.y - machine.y;
      const dz = motion.machineTarget.z - machine.z;
      const distance = Math.hypot(dx, dy, dz);
      if (distance > 1e-9) {
        const speed = motionSpeed(motion);
        const reach = speed * budget;
        if (reach < distance) {
          const f = reach / distance;
          machine.x += dx * f;
          machine.y += dy * f;
          machine.z += dz * f;
          budget = 0;
          break;
        }
        machine.x = motion.machineTarget.x;
        machine.y = motion.machineTarget.y;
        machine.z = motion.machineTarget.z;
        budget -= distance / speed;
      }
    }

    if (motion.dwell > 0) {
      const used = Math.min(budget, motion.dwell);
      motion.dwell -= used;
      budget -= used;
      if (motion.dwell > 1e-9) break;
    }

    queue.shift();
    if (motion.lastOfLine && motion.line > 0) completeLine(motion.line);
    motion.done?.();
  }

  if (queue.length === 0) {
    if (tickTimer !== undefined) {
      window.clearInterval(tickTimer);
      tickTimer = undefined;
    }
    finishActivity();
  }
};

const enqueue = (kind: Activity, motions: Motion[]) => {
  if (motions.length === 0) return;
  if (status.state === "DISCONNECTED") return;
  activity = kind;
  paused = false;
  queue.push(...motions);
  updateState();
  if (tickTimer === undefined) {
    lastTick = performance.now();
    tickTimer = window.setInterval(tick, TICK_MS);
  }
  broadcastStatus();
};

const stopMotion = () => {
  queue = [];
  if (tickTimer !== undefined) {
    window.clearInterval(tickTimer);
    tickTimer = undefined;
  }
  const kind = activity;
  activity = "idle";
  paused = false;
  status.feedSpeed = 0;
  if (kind === "job" && job) {
    fileStatus.sendState = "CANCELED";
    fileStatus.sendRemainingDuration = 0;
    job = null;
    // A stopped job leaves the spindle off, as a real soft reset does.
    applyEffect({ kind: "spindle", mode: "M5" });
  }
  onFinished = [];
  updateState();
  broadcastStatus();
};

const pauseMotion = () => {
  if (activity === "idle" || paused) return;
  paused = true;
  if (job) fileStatus.sendState = "PAUSED";
  updateState();
  broadcastStatus();
};

const resumeMotion = () => {
  if (!paused) return;
  paused = false;
  lastTick = performance.now();
  if (job) fileStatus.sendState = "RUNNING";
  updateState();
  broadcastStatus();
};

// --- building motions ------------------------------------------------------------

const motionsFromCommands = (commands: Command[], skipBeforeLine: number, forJob: boolean): Motion[] => {
  const motions: Motion[] = [];
  let plungeAdded = skipBeforeLine <= 1;
  for (const command of commands) {
    const apply = () => command.effects.forEach(applyEffect);
    if (command.line < skipBeforeLine) {
      // Skipped by "run from": its movement is dropped but its modal effects
      // (spindle, units...) still have to be in force by the resume point.
      if (command.effects.length > 0) {
        motions.push({ target: null, rapid: false, feed: 0, overridable: false, dwell: 0, line: 0, lastOfLine: false, effect: apply });
      }
      continue;
    }
    if (command.segments.length === 0) {
      motions.push({
        target: null, rapid: false, feed: 0, overridable: false, dwell: command.dwellSeconds,
        line: forJob ? command.line : 0, lastOfLine: true, effect: apply,
      });
      continue;
    }
    if (!plungeAdded) {
      plungeAdded = true;
      const first = command.segments[0];
      motions.push({ target: { x: first.start.x, y: first.start.y, z: first.start.z + 10 }, rapid: true, feed: 0, overridable: true, dwell: 0, line: 0, lastOfLine: false });
      motions.push({ target: { ...first.start }, rapid: false, feed: first.feedRate, overridable: true, dwell: 0, line: 0, lastOfLine: false });
    }
    command.segments.forEach((segment, index) => {
      motions.push({
        target: segment.end,
        rapid: segment.rapid,
        feed: segment.feedRate,
        overridable: true,
        dwell: 0,
        line: forJob ? command.line : 0,
        lastOfLine: index === command.segments.length - 1,
        effect: index === 0 && command.effects.length > 0 ? apply : undefined,
      });
    });
  }
  return motions;
};

// A jog is relative to where the tool will be once any jogs already queued
// finish, so quick repeated presses add up instead of overlapping.
const jogMotion = (delta: Vec): Motion => {
  const from = queue.length > 0 ? queue[queue.length - 1].target ?? getWorkPosition() : getWorkPosition();
  return {
    target: { x: from.x + delta.x, y: from.y + delta.y, z: from.z + delta.z },
    rapid: false, feed: settings.jogFeedRate, overridable: false, dwell: 0, line: 0, lastOfLine: false,
  };
};

// Runs console/macro G-code text. Returns once it's queued; `done` fires when
// everything it started has finished.
const runCommandText = (text: string, done: () => void) => {
  if (status.state === "DISCONNECTED" || activity === "job") {
    done();
    return;
  }
  const passThrough: string[] = [];
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    const upper = line.toUpperCase();
    if (!line) continue;
    if (upper === "$H") {
      goHome();
    } else if (upper === "$X") {
      status.state = "IDLE";
    } else if (upper.startsWith("$J=")) {
      passThrough.push(line.slice(3));
    } else if (upper.startsWith("$")) {
      // Other grbl settings/queries: accepted, nothing to do.
    } else if (/G10\s+L20/.test(upper)) {
      // G10 L20 P<n> X.. Y.. Z..: make the current position read as these work coordinates.
      const p = upper.match(/P(\d)/);
      const key = `G${53 + (p ? parseInt(p[1], 10) : 1)}`;
      const offset = wcsOffsets[key] ?? wcsOffsets.G54;
      for (const axis of ["X", "Y", "Z"] as const) {
        const m = upper.match(new RegExp(`${axis}(-?[0-9.]+)`));
        if (m) offset[axis.toLowerCase() as "x" | "y" | "z"] = machine[axis.toLowerCase() as "x" | "y" | "z"] - parseFloat(m[1]);
      }
    } else {
      passThrough.push(line);
    }
  }
  const parsed = parseGcode(passThrough.join("\n"), {
    start: getWorkPosition(),
    relative: status.distanceMode === "G91",
  });
  const motions = motionsFromCommands(parsed.commands, 0, false);
  if (motions.length === 0) {
    done();
    return;
  }
  onFinished.push(done);
  enqueue("mdi", motions);
};

const goHome = () => {
  if (status.state === "DISCONNECTED") return;
  const toWork = (v: Vec): Vec => {
    const offset = wcsOffsets[status.coordinateSystem] ?? wcsOffsets.G54;
    return { x: v.x - offset.x, y: v.y - offset.y, z: v.z - offset.z };
  };
  const base = { rapid: true, feed: 0, overridable: false, dwell: 0, line: 0, lastOfLine: false };
  enqueue("home", [
    { ...base, target: toWork({ x: machine.x, y: machine.y, z: HOME_MACHINE.z }) },
    { ...base, target: toWork(HOME_MACHINE) },
  ]);
};

// --- files ---------------------------------------------------------------------------

const countRows = () => program.commands.length;

const openFile = (name: string) => {
  if (files[name] === undefined) return;
  activeFile = name;
  program = parseGcode(files[name]);
  armedLine = 0;
  job = null;
  Object.assign(fileStatus, {
    sendState: "IDLE",
    fileName: name,
    rowCount: countRows(),
    completedRowCount: 0,
    remainingRowCount: countRows(),
    sendDuration: 0,
    sendRemainingDuration: 0,
    lastCompletedLineNumber: -1,
  });
  emit({ eventType: "FileStateEvent", event: { fileState: "FILE_LOADED" } });
};

const closeFile = () => {
  activeFile = "";
  program = { commands: [], segments: [] };
  armedLine = 0;
  Object.assign(fileStatus, {
    sendState: "IDLE", fileName: "", rowCount: 0, completedRowCount: 0, remainingRowCount: 0,
    sendDuration: 0, sendRemainingDuration: 0, lastCompletedLineNumber: -1,
  });
  emit({ eventType: "FileStateEvent", event: { fileState: "FILE_UNLOADED" } });
};

const startJob = () => {
  if (!activeFile || status.state === "DISCONNECTED") return;
  if (activity === "job" && paused) {
    resumeMotion();
    return;
  }
  if (activity !== "idle") return;
  const motions = motionsFromCommands(program.commands, armedLine, true);
  const streamed = program.commands.filter((command) => command.line >= armedLine);
  job = {
    totalSeconds: estimateSeconds(motions, getWorkPosition()),
    elapsed: 0,
    streamRows: streamed.length,
    completedRows: 0,
  };
  Object.assign(fileStatus, {
    sendState: "RUNNING",
    rowCount: streamed.length,
    completedRowCount: 0,
    remainingRowCount: streamed.length,
    sendDuration: 0,
    sendRemainingDuration: Math.round(job.totalSeconds * 1000),
    lastCompletedLineNumber: -1,
  });
  if (motions.length === 0) {
    fileStatus.sendState = "COMPLETED";
    job = null;
    return;
  }
  enqueue("job", motions);
};

const workspaceFileList = () => {
  const paths = Object.keys(files);
  const folders = new Set<string>(extraFolders);
  for (const path of paths) {
    const parts = path.split("/");
    for (let i = 1; i < parts.length; i++) folders.add(parts.slice(0, i).join("/"));
  }
  return {
    fileList: paths.map((path) => path.split("/").pop()),
    fileDetails: paths.map((path) => ({ path, size: files[path].length, lastModified: fileTimes[path] ?? Date.now() })),
    folderList: [...folders].sort(),
  };
};

// --- REST routing -----------------------------------------------------------------------------

const json = (data: unknown, status_ = 200): DemoResponse => ({
  status: status_,
  body: JSON.stringify(data),
  contentType: "application/json",
});
const text = (body: string): DemoResponse => ({ status: 200, body, contentType: "text/plain" });
const ok = (): DemoResponse => json({});

const clampOverride = (value: number) => Math.min(200, Math.max(10, value));

const applyOverride = (command: string) => {
  const o = status.overrides;
  switch (command) {
    case "CMD_FEED_OVR_RESET": o.feed = 100; break;
    case "CMD_FEED_OVR_COARSE_PLUS": o.feed = clampOverride(o.feed + 10); break;
    case "CMD_FEED_OVR_COARSE_MINUS": o.feed = clampOverride(o.feed - 10); break;
    case "CMD_RAPID_OVR_RESET": o.rapid = 100; break;
    case "CMD_RAPID_OVR_MEDIUM": o.rapid = 50; break;
    case "CMD_RAPID_OVR_LOW": o.rapid = 25; break;
    case "CMD_SPINDLE_OVR_RESET": o.spindle = 100; applySpindleSpeed(); break;
    case "CMD_SPINDLE_OVR_COARSE_PLUS": o.spindle = clampOverride(o.spindle + 10); applySpindleSpeed(); break;
    case "CMD_SPINDLE_OVR_COARSE_MINUS": o.spindle = clampOverride(o.spindle - 10); applySpindleSpeed(); break;
  }
};

const returnToZero = () => {
  const work = getWorkPosition();
  const base = { rapid: true, feed: 0, overridable: false, dwell: 0, line: 0, lastOfLine: false };
  const motions: Motion[] = [];
  if (work.z < 5) motions.push({ ...base, target: { x: work.x, y: work.y, z: 5 } });
  motions.push({ ...base, target: { x: 0, y: 0, z: Math.max(work.z, 5) } });
  enqueue("mdi", motions);
};

const resetToZero = (axis: string | null) => {
  const offset = wcsOffsets[status.coordinateSystem] ?? wcsOffsets.G54;
  const axes = axis ? [axis.toLowerCase()] : ["x", "y", "z"];
  for (const a of axes) {
    if (a === "x" || a === "y" || a === "z") offset[a] = machine[a];
  }
};

export type DemoRequest = {
  method: string;
  path: string; // e.g. "/api/v1/files/getFileStatus"
  query: URLSearchParams;
  body: string | FormData | null;
};

export const handleRequest = async (request: DemoRequest): Promise<DemoResponse> => {
  const { method, path, query, body } = request;
  const bodyText = typeof body === "string" ? body : "";
  const parseBody = () => {
    try {
      return JSON.parse(bodyText || "{}");
    } catch {
      return {};
    }
  };

  // Plugins: the list comes from the build (their files are static, beside the
  // page); a plugin's settings are kept in memory.
  const pluginSettingsMatch = path.match(/^\/api\/v1\/plugins\/([^/]+)\/settings$/);
  if (pluginSettingsMatch) {
    const id = decodeURIComponent(pluginSettingsMatch[1]);
    if (method === "POST") pluginSettings[id] = parseBody();
    return json(pluginSettings[id] ?? {});
  }

  switch (path) {
    // status / settings
    case "/api/v1/status/getStatus":
      return { status: 200, body: statusJson(), contentType: "application/json" };
    case "/api/v1/settings/getSettings":
      return json(settings);
    case "/api/v1/settings/setSettings":
      Object.assign(settings, parseBody());
      return json(settings);

    // connection
    case "/api/v1/machine/getPortList":
      return json(["Demo machine"]);
    case "/api/v1/machine/getSelectedPort":
      return json({ selectedPort: "Demo machine" });
    case "/api/v1/machine/getSelectedFirmware":
      return json({ selectedFirmware: "GRBL" });
    case "/api/v1/machine/getSelectedBaudRate":
      return json({ selectedBaudRate: "115200" });
    case "/api/v1/machine/getFirmwareList":
      return json(["GRBL"]);
    case "/api/v1/machine/getBaudRateList":
      return json(["115200"]);
    case "/api/v1/machine/disconnect":
      stopMotion();
      status.state = "DISCONNECTED";
      broadcastStatus();
      return ok();
    case "/api/v1/machine/connect":
      window.setTimeout(() => {
        if (status.state === "DISCONNECTED") {
          status.state = "IDLE";
          broadcastStatus();
        }
      }, 400);
      return ok();

    // motion
    case "/api/v1/machine/jog": {
      if (status.state !== "IDLE" && status.state !== "JOG") return ok();
      const dx = Number(query.get("x")) || 0;
      const dy = Number(query.get("y")) || 0;
      const dz = Number(query.get("z")) || 0;
      const stepXY = settings.jogStepSizeXY;
      const stepZ = settings.useZStepSize ? settings.jogStepSizeZ : stepXY;
      enqueue("jog", [jogMotion({ x: dx * stepXY, y: dy * stepXY, z: dz * stepZ })]);
      return ok();
    }
    case "/api/v1/machine/homeMachine":
      if (activity === "idle") goHome();
      return ok();
    case "/api/v1/machine/returnToZero":
      if (activity === "idle") returnToZero();
      return ok();
    case "/api/v1/machine/resetToZero":
      resetToZero(query.get("axis"));
      broadcastStatus();
      return ok();
    case "/api/v1/machine/softReset":
    case "/api/v1/machine/killAlarm":
      stopMotion();
      if (status.state !== "DISCONNECTED") status.state = "IDLE";
      broadcastStatus();
      return ok();
    case "/api/v1/machine/sendOverride":
      applyOverride(query.get("command") ?? "");
      broadcastStatus();
      return ok();
    case "/api/v1/machine/sendGcode": {
      const commands: string = parseBody().commands ?? "";
      commandEvent("COMMAND_SENT", commands);
      runCommandText(commands, () => commandEvent("COMMAND_COMPLETE", commands, "ok", true));
      return ok();
    }

    // macros
    case "/api/v1/macros/getMacroList":
      return json(macros);
    case "/api/v1/macros/saveMacroList": {
      const next = JSON.parse(bodyText || "[]");
      macros.length = 0;
      macros.push(...next);
      return json(macros);
    }
    case "/api/v1/macros/runMacro": {
      const macro = parseBody();
      const gcode: string = macro.gcode ?? "";
      commandEvent("COMMAND_SENT", gcode);
      runCommandText(gcode, () => commandEvent("COMMAND_COMPLETE", gcode, "ok", true));
      return ok();
    }

    // probing: pretend the plate is a few millimetres away
    case "/api/v1/probe/getSettings":
      return json(probeSettings);
    case "/api/v1/probe/saveSettings":
      Object.assign(probeSettings, parseBody());
      return ok();
    case "/api/v1/probe/run": {
      const { operation } = parseBody() as { operation: string };
      await new Promise((resolve) => window.setTimeout(resolve, 900));
      return json({
        success: true,
        probedPosition: {
          x: status.machineCoord.x + (operation.startsWith("X") ? -3.2 : 0),
          y: status.machineCoord.y + (operation.startsWith("Y") ? -3.2 : 0),
          z: operation === "Z" ? status.machineCoord.z - 8.4 : status.machineCoord.z,
          a: 0, b: 0, c: 0, units: "MM",
        },
      });
    }

    // files
    case "/api/v1/files/getFileStatus":
      return json(fileStatus);
    case "/api/v1/files/getWorkspaceFileList":
      return json(workspaceFileList());
    case "/api/v1/files/openWorkspaceFile": {
      const file = query.get("file");
      if (file) openFile(file);
      return ok();
    }
    case "/api/v1/files/createWorkspaceFolder": {
      const folder = query.get("path");
      if (folder) extraFolders.add(folder);
      return ok();
    }
    case "/api/v1/files/getFileContent":
      return text(files[query.get("file") || activeFile] ?? "");
    case "/api/v1/files/saveFileContent": {
      // In memory only - reloading the page restores the original samples.
      if (activeFile) {
        files[activeFile] = bodyText;
        fileTimes[activeFile] = Date.now();
        openFile(activeFile);
      }
      return ok();
    }
    case "/api/v1/files/saveFileContentAs": {
      const filename = query.get("filename");
      if (filename) {
        files[filename] = bodyText;
        fileTimes[filename] = Date.now();
        openFile(filename);
      }
      return ok();
    }
    case "/api/v1/files/uploadAndOpen": {
      // "Open from this device": read into memory, never uploaded anywhere.
      if (body instanceof FormData) {
        const file = body.get("file");
        if (file instanceof File) {
          files[file.name] = await file.text();
          fileTimes[file.name] = Date.now();
          openFile(file.name);
        }
      }
      return ok();
    }
    case "/api/v1/files/closeFile":
      stopMotion();
      closeFile();
      return ok();
    case "/api/v1/files/runFromLine":
      armedLine = Math.max(0, parseInt(query.get("line") ?? "0", 10) || 0);
      return ok();
    case "/api/v1/files/send":
      startJob();
      return ok();
    case "/api/v1/files/pause":
      if (paused) resumeMotion();
      else pauseMotion();
      return ok();
    case "/api/v1/files/cancel":
      stopMotion();
      return ok();

    // Review the editor's current text (POST, includes unsaved edits) or the loaded file (GET).
    case "/api/v1/review":
      if (!activeFile) return json({ error: "No file is currently loaded" }, 404);
      return json(reviewGcode(activeFile, method === "POST" ? bodyText : files[activeFile] ?? ""));

    case "/api/v1/visualizer/getToolpath":
      return json(toolpathFrom(program, armedLine));

    case "/api/v1/plugins/list":
      return json(__DEMO_PLUGINS__);
  }

  // Anything else is an endpoint the demo doesn't simulate. An empty success
  // here used to let the dashboard carry on with a response of the wrong shape
  // (a blank screen when the Review dialog got `{}`), so fail like a missing
  // route would - the dashboard's own error handling then applies.
  console.warn(`Demo: no simulation for ${method} ${path}`);
  return json({ error: "not simulated in the online demo" }, 404);
};

// Called once at startup by installDemo.
export const initDemoMachine = () => {
  syncCoordinates();
  openFile(DEFAULT_FILE);
};
