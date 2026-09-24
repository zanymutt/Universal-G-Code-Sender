import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { Button, ButtonGroup } from "react-bootstrap";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faBroom, faListOl, faPlay, faStop, faObjectGroup } from "@fortawesome/free-solid-svg-icons";
import { useAppDispatch } from "../hooks/useAppDispatch";
import { useAppSelector } from "../hooks/useAppSelector";
import { uiActions } from "../store/uiSlice";
import { getToolpath, ToolpathSegment } from "../services/visualizer";
import { sendGcode } from "../services/machine";
import {
  DEFAULT_RAPID_RATE_MM_PER_MIN,
  QUICK_SPEEDS,
  SimulationColorFn,
  ToolpathSimulation,
} from "../utils/toolpathSimulation";
import SimulationBar from "./SimulationBar";
import ViewCubeIcon from "./ViewCubeIcon";
import VisualizerReadout from "./VisualizerReadout";
import VisualizerZoomControl from "./VisualizerZoomControl";
import "./Visualizer3D.scss";

const RAPID_COLOR = new THREE.Color("#6b7280");
const CUT_COLOR = new THREE.Color("#4ade80");
const ARC_COLOR = new THREE.Color("#7bdcff");
// Matches desktop UGS's own selected-segment highlight (VisualizerUtils.Color.YELLOW).
const HIGHLIGHT_COLOR = new THREE.Color("rgb(237, 255, 0)");
// Matches desktop's GcodeLineColorizer "completed" color (VISUALIZER_OPTION_COMPLETE,
// default rgb(190,190,190) - its alpha isn't reproduced here since this material isn't
// transparent, but the gray-out itself is the part that matters).
const COMPLETED_COLOR = new THREE.Color("rgb(190, 190, 190)");

// The grid with nothing loaded: a fixed 200x200mm square, 10mm per cell.
const DEFAULT_GRID_SIZE = 200;
const GRID_CELL_SIZE = 10;
// How far past the toolpath's own bounds the grid should extend, per side.
const GRID_PADDING = 100;
// The grid, then the axis lines over it, are drawn before everything else (which
// has the default render order of 0) so the toolpath lands on top of them.
const GRID_RENDER_ORDER = -2;
const GRID_AXIS_RENDER_ORDER = -1;
const X_AXIS_COLOR = "#ff8a8a";
const Y_AXIS_COLOR = "#8affa0";

// Orthographic camera.zoom limits, shared by OrbitControls (wheel/pinch) and the
// on-screen zoom slider so both stop at the same place. 1 = the framing setView picks.
const MIN_ZOOM = 0.2;
const MAX_ZOOM = 40;

type Bounds = { minX: number; maxX: number; minY: number; maxY: number; inches: boolean };
type ViewPreset = "top" | "bottom" | "left" | "right" | "3d";

// What the simulation bar renders, mirrored out of ToolpathSimulation (which
// lives outside React) so the bar re-renders only when one of these changes.
type SimUi = {
  active: boolean;
  playing: boolean;
  speed: number;
  speeds: number[];
  realTime: boolean;
  elapsedSeconds: number;
  totalSeconds: number;
  progress: number;
  line: number;
  x: number;
  y: number;
  z: number;
  inches: boolean;
};
const INITIAL_SIM_UI: SimUi = {
  active: false,
  playing: false,
  speed: QUICK_SPEEDS[1],
  speeds: QUICK_SPEEDS,
  realTime: false,
  elapsedSeconds: 0,
  totalSeconds: 0,
  progress: 0,
  line: 0,
  x: 0,
  y: 0,
  z: 0,
  inches: false,
};
const snapshotSim = (sim: ToolpathSimulation): SimUi => {
  const position = sim.getPosition();
  return {
    active: sim.isActive(),
    playing: sim.isPlaying(),
    speed: sim.getSpeed(),
    speeds: sim.getSpeeds(),
    realTime: sim.isRealTiming(),
    elapsedSeconds: sim.getElapsedSeconds(),
    totalSeconds: sim.getTotalSeconds(),
    progress: sim.getProgress(),
    line: sim.getCurrentLine(),
    x: position.x,
    y: position.y,
    z: position.z,
    inches: sim.isInches(),
  };
};
const sameSimUi = (a: SimUi, b: SimUi) =>
  a.active === b.active &&
  a.playing === b.playing &&
  a.speed === b.speed &&
  a.speeds === b.speeds &&
  a.realTime === b.realTime &&
  a.elapsedSeconds === b.elapsedSeconds &&
  a.totalSeconds === b.totalSeconds &&
  a.progress === b.progress &&
  a.line === b.line &&
  a.x === b.x &&
  a.y === b.y &&
  a.z === b.z &&
  a.inches === b.inches;

const VIEW_BUTTONS: { view: ViewPreset; label: string; face: "top" | "left" | "right" | "bottom" | "all" }[] = [
  { view: "top", label: "Top", face: "top" },
  { view: "left", label: "Left", face: "left" },
  { view: "right", label: "Right", face: "right" },
  { view: "bottom", label: "Bottom", face: "bottom" },
  { view: "3d", label: "3D", face: "all" },
];

const RAPID_RATE_STORAGE_KEY = "ugs.dashboard.simulation.rapidRate";
// Wrapped because localStorage can be missing or throw (private windows, blocked
// site data) - the setting just doesn't persist then.
const readStoredRapidRate = () => {
  try {
    const stored = Number(window.localStorage.getItem(RAPID_RATE_STORAGE_KEY));
    return Number.isFinite(stored) && stored > 0 ? stored : DEFAULT_RAPID_RATE_MM_PER_MIN;
  } catch {
    return DEFAULT_RAPID_RATE_MM_PER_MIN;
  }
};

// The base color of a segment before any highlight/completed override: by type
// normally, or - "color by order" - a blue-to-red ramp over the whole program,
// which shows the cutting order at a glance without playing anything back.
// Rapids stay gray either way so travel still reads as travel. Returns a shared
// scratch color for the ramp, so callers must copy the channels out right away
// (both do) rather than hold on to it.
const orderScratch = new THREE.Color();
const segmentBaseColor = (segment: ToolpathSegment, index: number, count: number, byOrder: boolean) => {
  if (segment.rapid) return RAPID_COLOR;
  if (byOrder) return orderScratch.setHSL(0.66 * (1 - index / Math.max(1, count - 1)), 0.85, 0.55);
  return segment.arc ? ARC_COLOR : CUT_COLOR;
};
const ORDER_GRADIENT = "linear-gradient(90deg, hsl(238,85%,55%), hsl(180,85%,55%), hsl(119,85%,55%), hsl(59,85%,55%), hsl(0,85%,55%))";

const createAxisLabel = (text: string, color: string) => {
  const canvas = document.createElement("canvas");
  canvas.width = 128;
  canvas.height = 128;
  const ctx = canvas.getContext("2d");
  if (ctx) {
    ctx.font = "bold 96px sans-serif";
    ctx.fillStyle = color;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(text, 64, 70);
  }
  const texture = new THREE.CanvasTexture(canvas);
  return new THREE.Sprite(new THREE.SpriteMaterial({ map: texture, depthTest: false }));
};

// A small mm-coordinate label for the grid's ruler ticks - a wider, shorter
// canvas than createAxisLabel's (a number reads wider than it is tall,
// unlike a single "X"/"Y" letter), and left plain/gray rather than colored
// since there can be many of these at once along each edge.
const createTickLabel = (text: string) => {
  const canvas = document.createElement("canvas");
  canvas.width = 128;
  canvas.height = 64;
  const ctx = canvas.getContext("2d");
  if (ctx) {
    ctx.font = "bold 40px sans-serif";
    ctx.fillStyle = "#8a8f92";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(text, 64, 32);
  }
  const texture = new THREE.CanvasTexture(canvas);
  return new THREE.Sprite(new THREE.SpriteMaterial({ map: texture, depthTest: false }));
};

// Picks a "nice" tick spacing (1/2/5 x a power of ten) that lands roughly
// targetTicks times across the grid, the same approach chart axes use -
// without it, a fixed interval would either clutter a small grid or leave a
// huge one with only one or two labels.
const pickTickInterval = (size: number, targetTicks = 8) => {
  const raw = size / targetTicks;
  const magnitude = Math.pow(10, Math.floor(Math.log10(raw)));
  const normalized = raw / magnitude;
  const niceNormalized = normalized <= 1 ? 1 : normalized <= 2 ? 2 : normalized <= 5 ? 5 : 10;
  return niceNormalized * magnitude;
};

// getToolpath() already reflects an armed "run from" line - the backend
// reads the processed file (see VisualizerResource.getToolpath), which
// applyCommandProcessor/RunFromProcessor itself rewrites, skipped commands
// dropped and the resume preamble included - so no client-side filtering
// belongs here, just coloring.
//
// highlightLine is either the dashboard's 1-based editor line number (the
// user's manual cursor position, 0 = none) or, while a job is running,
// completedRowCount standing in for it (see liveHighlightLine) - both compare
// directly against ToolpathSegment.lineNumber, the backend's 0-based
// GcodeParser command index, with no offset. NOT the same "- 2" conversion
// "run from" needs - traced desktop's two features separately and they use
// different arithmetic:
// RunFromHere.java computes root.getElementIndex(caret) - 1 (elementIndex
// is already 0-based, so that's editorLine - 2 net). EditorListener.java
// passes the raw elementIndex (no extra - 1) to Highlight.setHighlightedLines,
// whose filter (lineNumber > start && lineNumber - 1 <= end) - worked
// through for a single cursor position - reduces to lineNumber == editorLine
// exactly, no offset at all. Confirmed empirically too: applying the run-
// from -2 here highlighted a visibly different segment than desktop did for
// the identical selected line.
//
// The correlation itself keeps working even once a line's armed:
// GcodeStreamWriter embeds each command's original commandNumber as
// metadata in the processed file (see addLine's commandNumber param), and
// GcodeStreamReader reads that same number back rather than recounting
// from scratch - so ToolpathSegment.lineNumber still reflects the
// *original* file's command index even for a command that only survived
// because RunFromProcessor's preamble carried it through.
// completedThroughLine mirrors desktop's GcodeLineColorizer.getColor: any segment whose
// lineNumber is less than it is already-run and gets grayed out (0 = nothing completed
// yet / not currently running, matching GcodeEditor.tsx's own dimThroughLine gate on
// RUN/HOLD/CHECK). It uses the same lineNumber space as highlightLine - see the comment
// above - so no separate offset is needed here either.
const buildToolpathGeometry = (
  segments: ToolpathSegment[],
  highlightLine: number,
  completedThroughLine: number,
  colorByOrder: boolean,
  hideRapids: boolean
) => {
  const highlightCommand = highlightLine;

  // "Clean" view draws only the cutting moves. Filtered here rather than per
  // vertex so the geometry is genuinely smaller, but colors still use each
  // segment's index in the full program so the order ramp doesn't shift.
  const positions = new Float32Array(segments.length * 6);
  const colors = new Float32Array(segments.length * 6);
  let written = 0;

  segments.forEach((segment, i) => {
    if (hideRapids && segment.rapid) return;
    const offset = written++ * 6;
    positions[offset] = segment.start.x;
    positions[offset + 1] = segment.start.y;
    positions[offset + 2] = segment.start.z;
    positions[offset + 3] = segment.end.x;
    positions[offset + 4] = segment.end.y;
    positions[offset + 5] = segment.end.z;

    const color =
      segment.lineNumber === highlightCommand
        ? HIGHLIGHT_COLOR
        : segment.lineNumber < completedThroughLine
          ? COMPLETED_COLOR
          : segmentBaseColor(segment, i, segments.length, colorByOrder);
    colors[offset] = color.r;
    colors[offset + 1] = color.g;
    colors[offset + 2] = color.b;
    colors[offset + 3] = color.r;
    colors[offset + 4] = color.g;
    colors[offset + 5] = color.b;
  });

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(positions.slice(0, written * 6), 3));
  geometry.setAttribute("color", new THREE.BufferAttribute(colors.slice(0, written * 6), 3));
  return geometry;
};

const Visualizer3D = () => {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const toolMarkerRef = useRef<THREE.Mesh | null>(null);
  const sceneRef = useRef<THREE.Scene | null>(null);
  const cameraRef = useRef<THREE.OrthographicCamera | null>(null);
  // Orthographic "zoom level" - the visible height in world units. Set by setView
  // to fit the loaded job, then reapplied on container resize (which only changes
  // aspect ratio, not how much of the job should be visible).
  const frustumSizeRef = useRef(100);
  const applyFrustumRef = useRef(() => {});
  const controlsRef = useRef<OrbitControls | null>(null);
  const dispatch = useAppDispatch();
  // Toolpath playback (see utils/toolpathSimulation). Created in the one-time
  // setup effect since it needs the scene; the UI state below mirrors it.
  const simRef = useRef<ToolpathSimulation | null>(null);
  const [simUi, setSimUi] = useState<SimUi>(INITIAL_SIM_UI);
  const lastSimLineSentRef = useRef(0);
  const [colorByOrder, setColorByOrder] = useState(false);
  // "Clean image": hides rapids and the grid/axes/rulers so only the cutting
  // path is left - for screenshots and for judging the part itself.
  const [cleanView, setCleanView] = useState(false);
  const cleanViewRef = useRef(false);
  cleanViewRef.current = cleanView;
  const applyGridVisibilityRef = useRef(() => {});
  const [rapidRate, setRapidRate] = useState(readStoredRapidRate);
  const rapidRateRef = useRef(rapidRate);
  rapidRateRef.current = rapidRate;
  // Read from inside callbacks that outlive the render that created them (the
  // async toolpath fetch), which would otherwise see a stale toggle.
  const colorByOrderRef = useRef(false);
  colorByOrderRef.current = colorByOrder;
  // Mirrors camera.zoom into React state for the slider - camera.zoom is changed
  // outside React (wheel, pinch, setView), so the render loop below compares it
  // against zoomSyncRef each frame and only sets state when it really moved.
  const [zoom, setZoomState] = useState(1);
  const zoomSyncRef = useRef(1);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const toolpathLinesRef = useRef<THREE.LineSegments | null>(null);
  // The last-fetched segments (already reflecting any armed "run from" line,
  // per getToolpath()) - cached so the cursor-highlight effect below can
  // recolor without re-fetching the toolpath from the server on every cursor
  // move, which doesn't change what the server would return anyway.
  const segmentsRef = useRef<ToolpathSegment[]>([]);
  const boundsSphereRef = useRef<THREE.Sphere | null>(null);
  const gridRef = useRef<THREE.GridHelper | null>(null);
  const xLabelRef = useRef<THREE.Sprite | null>(null);
  const yLabelRef = useRef<THREE.Sprite | null>(null);
  // Rebuilt from scratch every time the grid resizes (see applyGridExtent) -
  // how many there are, and where, depends on the current grid size.
  const tickLabelsRef = useRef<THREE.Sprite[]>([]);
  // Set inside the one-time setup effect below (it closes over the scene/refs it
  // needs); called from the toolpath-loading effect to resize/recenter the grid
  // to the loaded file, or put it back to the default size once nothing is loaded.
  const applyGridExtentRef = useRef((_size: number, _centerX: number, _centerY: number) => {});
  // Set inside the same setup effect as applyGridExtentRef, but called
  // separately from setView (see its own comment) rather than from
  // applyGridExtent, since it needs the freshly-computed frustum size that
  // only exists by the time setView runs, not whatever applyGridExtent's
  // own (differently-sized) grid happens to be.
  const updateTickLabelsRef = useRef((_centerX: number, _centerY: number, _halfExtent: number) => {});
  const [isEmpty, setIsEmpty] = useState(false);
  const [bounds, setBounds] = useState<Bounds | null>(null);
  const workCoord = useAppSelector((state) => state.status.workCoord);
  const currentState = useAppSelector((state) => state.status.state);
  const isIdle = useAppSelector((state) => state.status.state === "IDLE");
  const isJobActive = currentState === "RUN" || currentState === "HOLD" || currentState === "CHECK";
  // Only used to notice "a different file is now loaded" and re-fetch the
  // toolpath - the fetch itself always reads whatever's currently open.
  const fileName = useAppSelector((state) => state.fileStatus.fileName);
  // Not completedRowCount: that's just a count of rows from zero for
  // whatever's currently streaming, which badly undercounts once "run from"
  // starts a stream partway through the file - it'd read 1, 2, 3... while
  // segments keep the original file's line numbers (81, 82, 83...), so
  // nothing would ever compare equal/less-than and neither gray-out nor the
  // live highlight below would show at all. lastCompletedLineNumber is the
  // original file's own line number instead (see FileStatus.ts), correct
  // either way - -1 (nothing completed yet) safely matches/grays nothing.
  const lastCompletedLineNumber = useAppSelector((state) => state.fileStatus.lastCompletedLineNumber);
  const armedRunFromLine = useAppSelector((state) => state.ui.runFromLine);
  const editorCursorLine = useAppSelector((state) => state.ui.editorCursorLine);
  // Same RUN/HOLD/CHECK gate as GcodeEditor.tsx's dimThroughLine - only gray
  // out "already sent" segments while a job's actually streaming, since
  // lastCompletedLineNumber is otherwise just left over from the last job.
  const completedThroughLine =
    currentState === "RUN" || currentState === "HOLD" || currentState === "CHECK" ? lastCompletedLineNumber : 0;
  // Desktop's "yellow = currently transmitted" isn't a separate color at all -
  // it's this same cursor highlight, auto-driven to the just-completed line on
  // every CommandEvent by its (default-on) Follow feature (FollowLineUpdater,
  // SourceMultiviewElement.java) instead of the user's own click. Reproduce
  // that here: while running, the highlight tracks lastCompletedLineNumber
  // live instead of the last manual click - the two never apply at once,
  // since lastCompletedLineNumber === completedThroughLine in that state, so
  // this line is exactly the boundary (equal, not less-than) between gray
  // and normal.
  const liveHighlightLine =
    currentState === "RUN" || currentState === "HOLD" || currentState === "CHECK"
      ? lastCompletedLineNumber
      : editorCursorLine;
  // Bumped specifically once the backend's processed file is actually ready
  // (see uiSlice.ts's comment) - fileName alone isn't enough to re-trigger a
  // fetch here, since it's already set well before that file exists on disk.
  const toolpathVersion = useAppSelector((state) => state.ui.toolpathVersion);

  // Disposes/replaces just the toolpath geometry in the scene, from whatever
  // segments are passed in - shared by the fetch effect (fresh segments) and
  // the recolor effect below (the cached, already-fetched ones), so neither
  // has to duplicate the swap-into-scene bookkeeping.
  const applyToolpathGeometry = (segments: ToolpathSegment[]) => {
    const scene = sceneRef.current;
    if (!scene) return;

    if (toolpathLinesRef.current) {
      scene.remove(toolpathLinesRef.current);
      toolpathLinesRef.current.geometry.dispose();
      toolpathLinesRef.current = null;
    }
    if (segments.length === 0) return;

    // Highlights the cursor's line regardless of whether anything's armed -
    // see buildToolpathGeometry's comment: original command numbers survive
    // into the processed file's segments too, not just the unfiltered one.
    const geometry = buildToolpathGeometry(
      segments,
      liveHighlightLine,
      completedThroughLine,
      colorByOrderRef.current,
      cleanViewRef.current
    );
    const material = new THREE.LineBasicMaterial({ vertexColors: true });
    const toolpathLines = new THREE.LineSegments(geometry, material);
    // The simulation draws its own copy of the toolpath (solid + ghost) while
    // it's active - this one would only show through it.
    toolpathLines.visible = !simRef.current?.isActive();
    scene.add(toolpathLines);
    toolpathLinesRef.current = toolpathLines;
  };

  // Re-applies the toolpath geometry (recolor only, no re-fetch) whenever the
  // editor's cursor line or the live "already run"/"currently transmitting"
  // progress changes - none of these change what the server would return,
  // only which segments get highlighted or grayed out.
  useEffect(() => {
    if (segmentsRef.current.length > 0) {
      applyToolpathGeometry(segmentsRef.current);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [liveHighlightLine, completedThroughLine, colorByOrder, cleanView]);

  // One color function for both the main toolpath's base colors and the
  // simulation's copy, so "color by order" looks the same in either.
  const simColorFor = (order: boolean): SimulationColorFn => {
    const count = segmentsRef.current.length;
    return (segment, index) => segmentBaseColor(segment, index, count, order);
  };

  useEffect(() => {
    simRef.current?.setColorFor(simColorFor(colorByOrder));
    setSimUi((prev) => (simRef.current ? snapshotSim(simRef.current) : prev));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [colorByOrder]);

  useEffect(() => {
    simRef.current?.setShowRapids(!cleanView);
    applyGridVisibilityRef.current();
    setSimUi((prev) => (simRef.current ? snapshotSim(simRef.current) : prev));
  }, [cleanView]);

  useEffect(() => {
    simRef.current?.setRapidRate(rapidRate);
    setSimUi((prev) => (simRef.current ? snapshotSim(simRef.current) : prev));
    try {
      window.localStorage.setItem(RAPID_RATE_STORAGE_KEY, String(rapidRate));
    } catch {
      // Not persisting is fine - it just falls back to the default next time.
    }
  }, [rapidRate]);

  // While the simulation is up, the machine's own tool marker and the live
  // toolpath step aside so only one "tool" and one toolpath are on screen.
  useEffect(() => {
    if (toolMarkerRef.current) toolMarkerRef.current.visible = !simUi.active;
    if (toolpathLinesRef.current) toolpathLinesRef.current.visible = !simUi.active;
  }, [simUi.active]);

  // A real job starting takes over the visualizer (live gray-out, live tool
  // position, the editor's running-line highlight) - the simulation would just
  // fight it for all three, so it steps aside.
  useEffect(() => {
    if (isJobActive && simRef.current?.isActive()) exitSim();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isJobActive]);

  // Tells the editor which line the simulation is on (0 once it's not showing
  // one), at most ~12 times a second - fast playback can cross many lines per
  // frame, and the editor re-highlights and scrolls on every change. The
  // trailing timeout makes sure the final line always lands.
  useEffect(() => {
    const line = simUi.active ? simUi.line : 0;
    const wait = Math.max(0, 80 - (performance.now() - lastSimLineSentRef.current));
    const send = () => {
      lastSimLineSentRef.current = performance.now();
      dispatch(uiActions.setSimLine(line));
    };
    if (wait === 0) {
      send();
      return;
    }
    const timer = window.setTimeout(send, wait);
    return () => window.clearTimeout(timer);
  }, [simUi.active, simUi.line, dispatch]);

  useEffect(() => {
    if (toolMarkerRef.current) {
      toolMarkerRef.current.position.set(workCoord.x, workCoord.y, workCoord.z);
    }
  }, [workCoord]);

  const setView = (preset: ViewPreset) => {
    const camera = cameraRef.current;
    const renderer = rendererRef.current;
    const sphere = boundsSphereRef.current;
    if (!camera || !renderer || !sphere) return;

    const distance = sphere.radius * 2.2 || 100;
    const center = sphere.center;

    // Orthographic projection: how much of the scene is visible depends only on
    // this frustum size, not on the camera's distance from center - unlike a
    // perspective camera, distance no longer causes any parallax/foreshortening,
    // which is the whole point of switching to it for Top/Left/Right/Bottom.
    frustumSizeRef.current = sphere.radius * 2.4 || 100;
    updateTickLabelsRef.current(center.x, center.y, frustumSizeRef.current / 2);
    // Reset any zoom left over from however the user last scrolled/pinched the
    // previous view, so every preset starts from the same predictable framing.
    camera.zoom = 1;
    applyFrustumRef.current();

    // Z is always "up" except for the top/bottom views, which need Y as their
    // screen-up axis (a camera looking straight down/up the up-axis is degenerate).
    if (preset === "top") {
      camera.up.set(0, 1, 0);
      camera.position.set(center.x, center.y, center.z + distance);
    } else if (preset === "bottom") {
      camera.up.set(0, 1, 0);
      camera.position.set(center.x, center.y, center.z - distance);
    } else if (preset === "left") {
      camera.up.set(0, 0, 1);
      camera.position.set(center.x - distance, center.y, center.z);
    } else if (preset === "right") {
      camera.up.set(0, 0, 1);
      camera.position.set(center.x + distance, center.y, center.z);
    } else {
      camera.up.set(0, 0, 1);
      camera.position.set(center.x + distance, center.y - distance, center.z + distance);
    }
    camera.lookAt(center);

    // OrbitControls bakes the camera's up-axis into its internal rotation math at
    // construction time, and keeps its own damped rotation state between drags - so
    // a stale instance can silently pull a freshly-set preset view off-axis (e.g. a
    // "Left" view creeping into a downward tilt after the user had been dragging).
    // Recreating it guarantees the preset view is applied exactly, with no leftover
    // rotation momentum from however the user last left the camera.
    controlsRef.current?.dispose();
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.minZoom = MIN_ZOOM;
    controls.maxZoom = MAX_ZOOM;
    // Top/Left/Right/Bottom are flat, orthographic reference views - what
    // you mostly want to do there is slide the part around (pan) to line
    // it up, with rotating (checking it's not actually tilted in 3D) as the
    // occasional secondary action, the reverse of the 3D view's own
    // OrbitControls defaults (left = rotate, right = pan), which are left
    // untouched here since they're already right for that view.
    if (preset !== "3d") {
      controls.mouseButtons = {
        LEFT: THREE.MOUSE.PAN,
        MIDDLE: THREE.MOUSE.DOLLY,
        RIGHT: THREE.MOUSE.ROTATE,
      };
      // Two fingers zoom + pan only, never DOLLY_ROTATE: a pinch is never exactly
      // symmetric, so with rotate mixed in every pinch also twisted the flat view
      // slightly off-axis. Rotating a flat view isn't a touch action at all now -
      // the 3D button is the way to look at it from an angle.
      controls.touches = {
        ONE: THREE.TOUCH.PAN,
        TWO: THREE.TOUCH.DOLLY_PAN,
      };
    }
    controls.target.copy(center);
    controls.update();
    controlsRef.current = controls;
  };

  // Zoom slider / +- buttons. OrthographicCamera.zoom is the whole "how far in"
  // state (wheel and pinch write the same field), so setting it directly and
  // refreshing the projection is all it takes; the render loop then mirrors it
  // back into `zoom` state for the slider's thumb.
  const setZoom = (value: number) => {
    const camera = cameraRef.current;
    if (!camera) return;
    camera.zoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, value));
    camera.updateProjectionMatrix();
  };

  // Pulls the simulation's current state into React state, but only when
  // something the bar shows actually changed (cheap to call after any control).
  const syncSim = () => {
    const sim = simRef.current;
    if (!sim) return;
    const next = snapshotSim(sim);
    setSimUi((prev) => (sameSimUi(prev, next) ? prev : next));
  };

  // Hands the simulation a new toolpath (rewinding it) - and, if there's nothing
  // left to simulate (file closed, load failed), takes it out of active mode so
  // the bar doesn't linger over an empty viewport.
  const resetSimulation = (segments: ToolpathSegment[]) => {
    const sim = simRef.current;
    if (!sim) return;
    sim.setSegments(segments, simColorFor(colorByOrderRef.current));
    if (segments.length === 0) sim.setActive(false);
    syncSim();
  };

  const enterSim = () => {
    simRef.current?.setActive(true);
    syncSim();
  };

  const exitSim = () => {
    simRef.current?.setActive(false);
    syncSim();
  };

  const simControl = (action: (sim: ToolpathSimulation) => void) => {
    if (!simRef.current) return;
    action(simRef.current);
    syncSim();
  };

  const runBoundary = () => {
    if (!bounds) return;
    const commands = [
      `G0 X${bounds.minX.toFixed(3)} Y${bounds.minY.toFixed(3)}`,
      `G0 X${bounds.maxX.toFixed(3)} Y${bounds.minY.toFixed(3)}`,
      `G0 X${bounds.maxX.toFixed(3)} Y${bounds.maxY.toFixed(3)}`,
      `G0 X${bounds.minX.toFixed(3)} Y${bounds.maxY.toFixed(3)}`,
      `G0 X${bounds.minX.toFixed(3)} Y${bounds.minY.toFixed(3)}`,
    ].join("\n");
    sendGcode(commands);
  };

  // One-time scene/camera/renderer setup. Stays mounted for the component's whole
  // lifetime (switching Visualize/Edit/Split no longer tears this down), so the
  // camera position and OrbitControls state survive tab switches.
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color("#111213");
    sceneRef.current = scene;

    // Orthographic rather than perspective: parallel lines stay parallel and
    // sizes don't shrink with distance, so Top/Left/Right/Bottom views are true
    // flat projections (no parallax) instead of looking subtly skewed.
    const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 10000);
    camera.up.set(0, 0, 1);
    camera.position.set(100, -100, 100);
    camera.lookAt(0, 0, 0);
    cameraRef.current = camera;

    const renderer = new THREE.WebGLRenderer({ antialias: true });
    container.appendChild(renderer.domElement);
    rendererRef.current = renderer;

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.minZoom = MIN_ZOOM;
    controls.maxZoom = MAX_ZOOM;
    controlsRef.current = controls;

    // OrbitControls quirk: lifting one finger of a two-finger pinch hands the
    // remaining finger straight back to the one-finger gesture (rotate in the 3D
    // view, pan in the flat ones), so the tail end of nearly every pinch nudged
    // the view - the "pinch to zoom sometimes rotates" symptom. After a
    // multi-touch gesture, ignore the leftover finger until every finger is up.
    // The controls instance is recreated by setView, so this reads controlsRef
    // fresh on each event rather than closing over one instance.
    const activeTouches = new Set<number>();
    let multiTouch = false;
    const onTouchPointerDown = (event: PointerEvent) => {
      if (event.pointerType !== "touch") return;
      activeTouches.add(event.pointerId);
      if (activeTouches.size >= 2) multiTouch = true;
    };
    const onTouchPointerEnd = (event: PointerEvent) => {
      if (event.pointerType !== "touch") return;
      activeTouches.delete(event.pointerId);
      const active = controlsRef.current;
      if (!active) return;
      if (activeTouches.size === 0) {
        multiTouch = false;
        active.enabled = true;
      } else if (multiTouch) {
        active.enabled = false;
      }
    };
    renderer.domElement.addEventListener("pointerdown", onTouchPointerDown);
    renderer.domElement.addEventListener("pointerup", onTouchPointerEnd);
    renderer.domElement.addEventListener("pointercancel", onTouchPointerEnd);

    const xLabel = createAxisLabel("X", X_AXIS_COLOR);
    const yLabel = createAxisLabel("Y", Y_AXIS_COLOR);
    scene.add(xLabel);
    scene.add(yLabel);
    xLabelRef.current = xLabel;
    yLabelRef.current = yLabel;

    // GridHelper only takes one color for both its center lines, so it can't give
    // the X and Y center lines different colors on its own - drawn as two plain
    // Line objects instead, on top of it (slightly raised in Z to avoid z-fighting).
    const xAxisLine = new THREE.Line(
      new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]),
      new THREE.LineBasicMaterial({ color: X_AXIS_COLOR })
    );
    const yAxisLine = new THREE.Line(
      new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]),
      new THREE.LineBasicMaterial({ color: Y_AXIS_COLOR })
    );
    // The grid and axes are a backdrop: drawn first and never written to the depth
    // buffer, so the toolpath always draws over them. Left as ordinary depth-tested
    // lines at Z=0, they hid any cut below the surface (Z<0) wherever a grid line
    // lay exactly over it - a straight edge on a 10mm grid line vanished in the
    // 2D views, where the two line up pixel for pixel.
    const makeBackdrop = (line: THREE.Line | THREE.LineSegments, order: number) => {
      (line.material as THREE.Material).depthWrite = false;
      line.renderOrder = order;
    };
    makeBackdrop(xAxisLine, GRID_AXIS_RENDER_ORDER);
    makeBackdrop(yAxisLine, GRID_AXIS_RENDER_ORDER);
    scene.add(xAxisLine);
    scene.add(yAxisLine);

    const applyGridExtent = (size: number, centerX: number, centerY: number) => {
      if (gridRef.current) {
        scene.remove(gridRef.current);
        gridRef.current.dispose();
      }
      // GridHelper(size, divisions) divides its own size evenly into
      // `divisions` cells and is positioned wherever asked - neither of
      // those, on their own, land its lines on true multiples of
      // GRID_CELL_SIZE relative to work-coordinate zero: `size` isn't
      // necessarily a whole multiple of it (divisions was only ever
      // *rounded* to the nearest one, so each cell was only approximately
      // 10mm), and centerX/centerY are the part's own bounding-box center,
      // an arbitrary position with no reason to fall on a cell boundary
      // itself. Snapping the requested size/center out to the nearest
      // GRID_CELL_SIZE boundary first fixes both at once: an exact whole
      // number of exactly-10mm cells, positioned so a line falls exactly on
      // every multiple of 10 (0, 10, 20, -10, ...), confirmed visually
      // against the tick labels below, which were already computed that way.
      const half = size / 2;
      const snappedHalf = Math.ceil(half / GRID_CELL_SIZE) * GRID_CELL_SIZE;
      const snappedSize = snappedHalf * 2;
      const snappedCenterX = Math.round(centerX / GRID_CELL_SIZE) * GRID_CELL_SIZE;
      const snappedCenterY = Math.round(centerY / GRID_CELL_SIZE) * GRID_CELL_SIZE;
      const divisions = snappedSize / GRID_CELL_SIZE;
      const grid = new THREE.GridHelper(snappedSize, divisions, 0x2f3132, 0x2f3132);
      grid.rotation.x = Math.PI / 2;
      grid.position.set(snappedCenterX, snappedCenterY, 0);
      makeBackdrop(grid, GRID_RENDER_ORDER);
      scene.add(grid);
      gridRef.current = grid;
      // These mark true work-coordinate zero (X0/Y0), not wherever the grid itself
      // is currently centered - the grid recenters on the loaded job, but zero
      // doesn't move just because the job isn't drawn around it. The X line runs
      // along Y=0 (spanning the grid's X extent); the Y line runs along X=0
      // (spanning the grid's Y extent) - each sized to the grid, but pinned to 0
      // on the other axis instead of following centerX/centerY.
      xAxisLine.geometry.setFromPoints([
        new THREE.Vector3(centerX - half, 0, 0.05),
        new THREE.Vector3(centerX + half, 0, 0.05),
      ]);
      yAxisLine.geometry.setFromPoints([
        new THREE.Vector3(0, centerY - half, 0.05),
        new THREE.Vector3(0, centerY + half, 0.05),
      ]);

      const labelScale = Math.max(size * 0.06, 8);
      xLabel.position.set(centerX + half + labelScale, 0, 1);
      xLabel.scale.set(labelScale, labelScale, 1);
      yLabel.position.set(0, centerY + half + labelScale, 1);
      yLabel.scale.set(labelScale, labelScale, 1);
      applyGridVisibility();
    };
    // Everything that makes up the "grid" for the clean-image toggle - the grid
    // itself, the X/Y axis lines and letters, and the mm ruler labels. Called
    // whenever any of those are (re)created too, since grid and labels are
    // rebuilt from scratch on every resize.
    const applyGridVisibility = () => {
      const visible = !cleanViewRef.current;
      if (gridRef.current) gridRef.current.visible = visible;
      xAxisLine.visible = visible;
      yAxisLine.visible = visible;
      xLabel.visible = visible;
      yLabel.visible = visible;
      tickLabelsRef.current.forEach((label) => (label.visible = visible));
    };
    applyGridVisibilityRef.current = applyGridVisibility;
    applyGridExtentRef.current = applyGridExtent;
    applyGridExtent(DEFAULT_GRID_SIZE, 0, 0);

    // mm ruler ticks along the grid's bottom/left edges, at (roughly) the
    // actual edge of what the camera currently shows - not the grid's own
    // (deliberately much larger, padded-for-context) extent. Those two look
    // like they should be the same thing but aren't: applyGridExtent's own
    // `size` includes GRID_PADDING on every side so the grid still reads as
    // a grid around the part rather than hugging it, while the camera only
    // frames the part itself - ticks placed at the grid's own edge landed
    // almost entirely outside the visible area, confirmed via logging
    // before switching to this. halfExtent is passed in by the caller
    // (setView, using its own freshly-computed frustumSizeRef) rather than
    // computed from the grid, and reused as both the X and Y range for
    // simplicity - not exactly the visible width in every view (Left/Right
    // in particular don't map screen axes to world X/Y the same way Top
    // does), but a reasonable one that's usually at least roughly right,
    // rather than the previous "usually entirely off-screen."
    const updateTickLabels = (centerX: number, centerY: number, halfExtent: number) => {
      tickLabelsRef.current.forEach((sprite) => {
        scene.remove(sprite);
        sprite.material.map?.dispose();
        sprite.material.dispose();
      });
      tickLabelsRef.current = [];

      const interval = pickTickInterval(halfExtent * 2);
      const tickScale = Math.max(halfExtent * 0.07, 5);
      // Inset from the boundary, not offset past it - halfExtent is tied
      // directly to the camera's own visible edge now (see this function's
      // own comment), not a padded grid with margin to spare, so a label
      // placed beyond it just gets clipped off-screen (confirmed: that's
      // exactly what was happening here before this used +tickScale).
      const firstXTick = Math.ceil((centerX - halfExtent) / interval) * interval;
      for (let x = firstXTick; x <= centerX + halfExtent + 1e-6; x += interval) {
        const label = createTickLabel(String(Math.round(x)));
        label.position.set(x, centerY - halfExtent + tickScale * 0.8, 0.5);
        label.scale.set(tickScale, tickScale * 0.5, 1);
        scene.add(label);
        tickLabelsRef.current.push(label);
      }
      const firstYTick = Math.ceil((centerY - halfExtent) / interval) * interval;
      for (let y = firstYTick; y <= centerY + halfExtent + 1e-6; y += interval) {
        const label = createTickLabel(String(Math.round(y)));
        label.position.set(centerX - halfExtent + tickScale * 1.2, y, 0.5);
        label.scale.set(tickScale, tickScale * 0.5, 1);
        scene.add(label);
        tickLabelsRef.current.push(label);
      }
    };
    updateTickLabelsRef.current = (centerX, centerY, halfExtent) => {
      updateTickLabels(centerX, centerY, halfExtent);
      applyGridVisibility();
    };
    updateTickLabels(0, 0, DEFAULT_GRID_SIZE / 2);

    // A cone pointing straight down at the tool position, tip-first - closer to
    // how an actual bit/torch looks than a plain ball. ConeGeometry's tip points
    // along +Y by default; rotate it onto -Z (down, since Z is up in this scene)
    // then shift it so the tip - not the geometric center - sits at the mesh's
    // position, so setting toolMarker.position to the current coordinate puts the
    // tip exactly there with the body rising above it.
    const toolMarkerHeight = 8;
    const toolMarkerGeometry = new THREE.ConeGeometry(2, toolMarkerHeight, 16);
    toolMarkerGeometry.rotateX(-Math.PI / 2);
    toolMarkerGeometry.translate(0, 0, toolMarkerHeight / 2);
    const toolMarker = new THREE.Mesh(toolMarkerGeometry, new THREE.MeshBasicMaterial({ color: "#ffd400" }));
    scene.add(toolMarker);
    toolMarkerRef.current = toolMarker;

    const simulation = new ToolpathSimulation(scene);
    simulation.setRapidRate(rapidRateRef.current);
    simulation.setShowRapids(!cleanViewRef.current);
    simRef.current = simulation;

    const applyFrustum = () => {
      const { clientWidth, clientHeight } = container;
      if (clientWidth === 0 || clientHeight === 0) return;
      const aspect = clientWidth / clientHeight;
      const size = frustumSizeRef.current;
      camera.left = (-size * aspect) / 2;
      camera.right = (size * aspect) / 2;
      camera.top = size / 2;
      camera.bottom = -size / 2;
      camera.updateProjectionMatrix();
    };
    applyFrustumRef.current = applyFrustum;

    const resize = () => {
      const { clientWidth, clientHeight } = container;
      if (clientWidth === 0 || clientHeight === 0) return;
      applyFrustum();
      renderer.setSize(clientWidth, clientHeight);
    };
    resize();
    const resizeObserver = new ResizeObserver(resize);
    resizeObserver.observe(container);

    let animationFrame: number;
    let lastFrameTime = performance.now();
    const animate = () => {
      // Capped so coming back to a backgrounded tab doesn't fast-forward the
      // simulation through everything it "missed".
      const now = performance.now();
      const deltaSeconds = Math.min(0.1, (now - lastFrameTime) / 1000);
      lastFrameTime = now;
      if (simulation.update(deltaSeconds)) {
        const next = snapshotSim(simulation);
        setSimUi((prev) => (sameSimUi(prev, next) ? prev : next));
      }
      controlsRef.current?.update();
      if (camera.zoom !== zoomSyncRef.current) {
        zoomSyncRef.current = camera.zoom;
        setZoomState(camera.zoom);
      }
      renderer.render(scene, camera);
      animationFrame = requestAnimationFrame(animate);
    };
    animate();

    return () => {
      cancelAnimationFrame(animationFrame);
      resizeObserver.disconnect();
      renderer.domElement.removeEventListener("pointerdown", onTouchPointerDown);
      renderer.domElement.removeEventListener("pointerup", onTouchPointerEnd);
      renderer.domElement.removeEventListener("pointercancel", onTouchPointerEnd);
      controlsRef.current?.dispose();
      simulation.dispose();
      simRef.current = null;
      renderer.dispose();
      toolpathLinesRef.current?.geometry.dispose();
      gridRef.current?.dispose();
      xLabel.material.map?.dispose();
      xLabel.material.dispose();
      yLabel.material.map?.dispose();
      yLabel.material.dispose();
      tickLabelsRef.current.forEach((sprite) => {
        sprite.material.map?.dispose();
        sprite.material.dispose();
      });
      tickLabelsRef.current = [];
      xAxisLine.geometry.dispose();
      xAxisLine.material.dispose();
      yAxisLine.geometry.dispose();
      yAxisLine.material.dispose();
      container.removeChild(renderer.domElement);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Re-fetches and rebuilds the toolpath geometry whenever a different file is
  // opened, the armed "run from" line changes, or the backend reports the
  // processed file is actually ready (toolpathVersion - see its comment in
  // uiSlice.ts). fileName alone used to be the only trigger, but it's set as
  // soon as the file starts opening, well before VisualizerResource's
  // processed file exists on disk - a fetch right then could come back
  // empty with nothing left to retry it once the file was actually ready,
  // which is exactly what made the very first open of a file (but not a
  // subsequent reload) fail to visualize. Arming/resetting a "run from" line
  // needs a fresh fetch too, since that rewrites the processed file the same
  // way (see VisualizerResource.getToolpath's doc comment) - and framing/
  // bounds intentionally follow whatever's actually visible (the now-
  // server-filtered set), so the camera reframes on arming too, confirmed
  // that's what desktop's own visualizer does as well.
  useEffect(() => {
    const scene = sceneRef.current;
    if (!scene) return;

    setIsEmpty(false);
    setBounds(null);
    boundsSphereRef.current = null;

    if (toolpathLinesRef.current) {
      scene.remove(toolpathLinesRef.current);
      toolpathLinesRef.current.geometry.dispose();
      toolpathLinesRef.current = null;
    }

    // Same class of bug fileStatusSlice was already fixed for (see its own
    // comment) - toolpathVersion now bumps on every close/open/save (not
    // just a websocket push), so overlapping getToolpath() calls are a real
    // possibility, not just a theoretical one: closing has nothing to parse
    // and resolves almost immediately, while a real open/reload has to read
    // and parse the file first - so a close's empty result arriving *after*
    // a subsequent open's real one silently blanked the visualizer despite
    // the backend correctly having a file loaded. cancelled, checked in
    // every branch below, discards a response from a request this effect
    // itself no longer cares about, the same guard GcodeEditor's own file-
    // loading effect already uses.
    let cancelled = false;
    getToolpath().then((segments) => {
      if (cancelled) return;
      segmentsRef.current = segments;
      resetSimulation(segments);
      if (segments.length === 0) {
        setIsEmpty(true);
        applyGridExtentRef.current(DEFAULT_GRID_SIZE, 0, 0);
        updateTickLabelsRef.current(0, 0, DEFAULT_GRID_SIZE / 2);
        // Without this, the Top/Left/Right/Bottom/3D buttons silently did
        // nothing until a file was loaded - setView bails out with no
        // bounds sphere to frame on. A sphere centered on the empty grid
        // itself (matching its DEFAULT_GRID_SIZE) keeps them working before
        // anything's been opened, framing the grid instead of a part.
        boundsSphereRef.current = new THREE.Sphere(new THREE.Vector3(0, 0, 0), DEFAULT_GRID_SIZE / 2.4);
        return;
      }

      applyToolpathGeometry(segments);

      // Frame/bound on the actual cutting moves only, not rapids: a big safe-Z
      // retract or a "return to X0 Y0" at the end of a file would otherwise drag
      // the framing center and the min/max readout out over empty space that was
      // never really part of the job, and make side views look tilted (the camera
      // ends up centered high above the Z=0 floor grid instead of near the part).
      const cutPoints = new THREE.Box3();
      const expandWith = (segment: ToolpathSegment) => {
        cutPoints.expandByPoint(new THREE.Vector3(segment.start.x, segment.start.y, segment.start.z));
        cutPoints.expandByPoint(new THREE.Vector3(segment.end.x, segment.end.y, segment.end.z));
      };
      segments.filter((segment) => !segment.rapid).forEach(expandWith);
      // An all-rapid file has no cutting moves to frame on - fall back to
      // every segment's own extent so the camera still frames something.
      if (cutPoints.isEmpty()) {
        segments.forEach(expandWith);
      }

      setBounds({
        minX: cutPoints.min.x,
        maxX: cutPoints.max.x,
        minY: cutPoints.min.y,
        maxY: cutPoints.max.y,
        inches: segments[0]?.inches === true,
      });

      // Grid grows to fit the loaded job, padded out on every side, so the whole
      // part sits comfortably inside it rather than floating over a generic
      // 200x200 square (or spilling off the edge of one, for anything bigger).
      if (!cutPoints.isEmpty()) {
        const width = cutPoints.max.x - cutPoints.min.x;
        const height = cutPoints.max.y - cutPoints.min.y;
        const size = Math.max(width, height) + GRID_PADDING * 2;
        const centerX = (cutPoints.min.x + cutPoints.max.x) / 2;
        const centerY = (cutPoints.min.y + cutPoints.max.y) / 2;
        applyGridExtentRef.current(size, centerX, centerY);
      } else {
        applyGridExtentRef.current(DEFAULT_GRID_SIZE, 0, 0);
      }

      const sphere = new THREE.Sphere();
      cutPoints.getBoundingSphere(sphere);
      if (sphere.radius > 0) {
        boundsSphereRef.current = sphere;
        setView("3d");
      }
    }).catch(() => {
      if (cancelled) return;
      resetSimulation([]);
      setIsEmpty(true);
      applyGridExtentRef.current(DEFAULT_GRID_SIZE, 0, 0);
      updateTickLabelsRef.current(0, 0, DEFAULT_GRID_SIZE / 2);
      boundsSphereRef.current = new THREE.Sphere(new THREE.Vector3(0, 0, 0), DEFAULT_GRID_SIZE / 2.4);
    });

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fileName, armedRunFromLine, toolpathVersion]);

  return (
    <div className="visualizer3D">
      <div className="visualizer3DToolbar">
        {/* Each button carries both a text label and an icon; the toolbar's
            container query (Visualizer3D.scss) swaps to icons only once the
            labels stop fitting on one row. title/aria-label keep the icon-only
            buttons identifiable. */}
        <ButtonGroup>
          {VIEW_BUTTONS.map(({ view, label, face }) => (
            <Button key={view} variant="outline-secondary" title={`${label} view`} aria-label={`${label} view`} onClick={() => setView(view)}>
              <span className="visualizer3DButtonIcon"><ViewCubeIcon face={face} /></span>
              <span className="visualizer3DButtonLabel">{label}</span>
            </Button>
          ))}
        </ButtonGroup>

        <ButtonGroup>
          <Button
            variant={simUi.active ? "primary" : "outline-primary"}
            disabled={simUi.active ? false : !bounds || isJobActive}
            onClick={simUi.active ? exitSim : enterSim}
            title="Play the toolpath back in program order to see what gets cut when"
            aria-label="Simulate"
          >
            <span className="visualizer3DButtonIcon"><FontAwesomeIcon icon={simUi.active ? faStop : faPlay} /></span>
            <span className="visualizer3DButtonLabel">Simulate</span>
          </Button>
          <Button
            variant={colorByOrder ? "primary" : "outline-primary"}
            disabled={!bounds}
            onClick={() => setColorByOrder(!colorByOrder)}
            title="Color the toolpath from blue (first) to red (last) to show the cutting order"
            aria-label="Order"
          >
            <span className="visualizer3DButtonIcon"><FontAwesomeIcon icon={faListOl} /></span>
            <span className="visualizer3DButtonLabel">Order</span>
          </Button>
          <Button
            variant={cleanView ? "primary" : "outline-primary"}
            onClick={() => setCleanView(!cleanView)}
            title="Clean image: hide rapid moves and the grid, leaving just the cutting path"
            aria-label="Clean"
          >
            <span className="visualizer3DButtonIcon"><FontAwesomeIcon icon={faBroom} /></span>
            <span className="visualizer3DButtonLabel">Clean</span>
          </Button>
        </ButtonGroup>

        <Button
          className="visualizer3DBoundary"
          variant="outline-primary"
          disabled={!bounds || !isIdle}
          onClick={runBoundary}
          title="Rapid the machine around the toolpath's bounding box at the current Z, to check stock/part alignment before running"
          aria-label="Run boundary"
        >
          <span className="visualizer3DButtonIcon"><FontAwesomeIcon icon={faObjectGroup} /></span>
          <span className="visualizer3DButtonLabel">Run boundary</span>
        </Button>
      </div>

      <div className="visualizer3DBody">
        {isEmpty && <div className="visualizer3DEmpty">No file loaded to visualize.</div>}
        <div className="visualizer3DCanvas" ref={containerRef} />
        {simUi.active ? (
          <VisualizerReadout
            live
            label="Simulated tool position"
            units={simUi.inches ? "in" : "mm"}
            rows={[
              { axis: "X", value: simUi.x.toFixed(3) },
              { axis: "Y", value: simUi.y.toFixed(3) },
              { axis: "Z", value: simUi.z.toFixed(3) },
            ]}
          />
        ) : (
          bounds && (
            <VisualizerReadout
              label="Toolpath extents"
              units={bounds.inches ? "in" : "mm"}
              rows={[
                { axis: "X", value: `${bounds.minX.toFixed(bounds.inches ? 2 : 1)} → ${bounds.maxX.toFixed(bounds.inches ? 2 : 1)}` },
                { axis: "Y", value: `${bounds.minY.toFixed(bounds.inches ? 2 : 1)} → ${bounds.maxY.toFixed(bounds.inches ? 2 : 1)}` },
              ]}
            />
          )
        )}
        {colorByOrder && (
          <div className="visualizer3DOrderLegend" title="First move to last move">
            <span>start</span>
            <div className="visualizer3DOrderRamp" style={{ background: ORDER_GRADIENT }} />
            <span>end</span>
          </div>
        )}
        {simUi.active && (
          <SimulationBar
            playing={simUi.playing}
            speed={simUi.speed}
            speeds={simUi.speeds}
            realTime={simUi.realTime}
            elapsedSeconds={simUi.elapsedSeconds}
            totalSeconds={simUi.totalSeconds}
            rapidRate={rapidRate}
            progress={simUi.progress}
            line={simUi.line}
            onPlay={() => simControl((sim) => sim.play())}
            onPause={() => simControl((sim) => sim.pause())}
            onRestart={() => simControl((sim) => sim.restart())}
            onStepBack={() => simControl((sim) => sim.stepBack())}
            onStepForward={() => simControl((sim) => sim.stepForward())}
            onSeek={(fraction) => simControl((sim) => sim.seek(fraction))}
            onSpeed={(speed) => simControl((sim) => sim.setSpeed(speed))}
            onRapidRate={setRapidRate}
            onClose={exitSim}
          />
        )}
        <VisualizerZoomControl
          zoom={zoom}
          minZoom={MIN_ZOOM}
          maxZoom={MAX_ZOOM}
          onChange={setZoom}
          onZoomBy={(factor) => setZoom((cameraRef.current?.zoom ?? 1) * factor)}
        />
      </div>
    </div>
  );
};

export default Visualizer3D;
