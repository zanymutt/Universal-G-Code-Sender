import * as THREE from "three";
import { ToolpathSegment } from "../services/visualizer";

// Speed presets, as multiples of the simulation's own clock. With real timing
// (the file carries feed rates) 1x is real time, so the presets climb steeply -
// a 40-minute job needs ~200x to watch in about a minute. Without feed data the
// clock is a made-up one that plays any job in BASE_DURATION_SECONDS at 1x, so
// small multiples are enough.
export const REAL_TIME_SPEEDS = [1, 5, 20, 60, 200, 1000];
export const QUICK_SPEEDS = [1, 2, 5, 10, 30];

export const DEFAULT_RAPID_RATE_MM_PER_MIN = 3000;

// With no feed data (or a toolpath from a backend that doesn't send it), the
// whole job plays in this many seconds at 1x, whatever its size.
const BASE_DURATION_SECONDS = 60;
// ...and a rapid costs this fraction of a cut's time per unit of length there.
const QUICK_RAPID_TIME_FACTOR = 0.25;
// The default real-time speed is the slowest preset that fits the job into about this long.
const TARGET_WATCH_SECONDS = 60;
const MM_PER_INCH = 25.4;
const GHOST_OPACITY = 0.18;
const HEAD_COLOR = new THREE.Color("rgb(237, 255, 0)");
const MARKER_COLOR = "#ff7a1a";

export type SimulationColorFn = (segment: ToolpathSegment, index: number) => THREE.Color;

// Plays a toolpath back in program order: everything already "cut" is drawn
// solid, everything still to come is drawn as a dim ghost, and the segment in
// progress is a bright line growing toward the tool marker.
//
// Segments arrive in program order, so "the first N segments" is a contiguous
// vertex range - playback only ever moves a draw range and one two-point line,
// never rebuilds geometry, which is what keeps it smooth on large files. (With
// rapids hidden that range is over an index of just the visible segments, still
// contiguous in program order.)
//
// Time is held as a cumulative array (seconds) so a playhead position maps to
// a segment by binary search. Cuts take length / feed rate at the file's own
// units; rapids take length / a configurable rapid rate. It's an estimate: it
// assumes the machine hits the programmed feed instantly and ignores dwells
// (G4) and acceleration, so real runs - especially on curvy, many-segment
// paths - come out somewhat longer.
export class ToolpathSimulation {
  private readonly group = new THREE.Group();
  private readonly marker: THREE.Mesh;
  private readonly head: THREE.Line;
  private readonly headPositions = new Float32Array(6);
  private ghost: THREE.LineSegments | null = null;
  private done: THREE.LineSegments | null = null;

  private segments: ToolpathSegment[] = [];
  private colorFor: SimulationColorFn = () => HEAD_COLOR;
  // Whether the built geometry no longer matches segments/colorFor/showRapids -
  // it's only (re)built while the simulation is active, so a file that's loaded
  // and never simulated costs nothing.
  private dirty = true;
  // cumulative[i] = playhead time at which segment i starts; the last entry is the total.
  private cumulative = new Float64Array(1);
  // Playhead time at the end of each run of segments sharing a lineNumber
  // (arcs are many segments per line), for stepping line by line.
  private lineEnds: number[] = [];
  // With rapids hidden: visibleBefore[i] = how many non-rapid segments precede segment i.
  private visibleBefore: Uint32Array | null = null;
  private realTiming = false;
  private rapidRate = DEFAULT_RAPID_RATE_MM_PER_MIN;
  private showRapids = true;
  private active = false;
  private playing = false;
  private time = 0;
  private speed = QUICK_SPEEDS[1];
  private renderedTime = -1;

  constructor(private readonly scene: THREE.Scene) {
    // Same cone as the machine's own tool marker (tip at the origin, body rising
    // along +Z), in a different color so the simulated tool can't be mistaken
    // for the real one.
    const height = 8;
    const geometry = new THREE.ConeGeometry(2, height, 16);
    geometry.rotateX(-Math.PI / 2);
    geometry.translate(0, 0, height / 2);
    this.marker = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({ color: MARKER_COLOR }));

    const headGeometry = new THREE.BufferGeometry();
    headGeometry.setAttribute("position", new THREE.BufferAttribute(this.headPositions, 3));
    this.head = new THREE.Line(headGeometry, new THREE.LineBasicMaterial({ color: HEAD_COLOR }));
    // Its bounds change every frame and it's tiny - never worth frustum-culling.
    this.head.frustumCulled = false;

    this.group.add(this.marker, this.head);
    this.group.visible = false;
    scene.add(this.group);
  }

  isActive() {
    return this.active;
  }

  isPlaying() {
    return this.playing;
  }

  getSpeed() {
    return this.speed;
  }

  getSpeeds() {
    return this.realTiming ? REAL_TIME_SPEEDS : QUICK_SPEEDS;
  }

  // True when the timing comes from the file's feed rates (so the clock reads
  // real, estimated seconds) rather than the made-up uniform one.
  isRealTiming() {
    return this.realTiming;
  }

  getElapsedSeconds() {
    return this.time;
  }

  getTotalSeconds() {
    return this.total();
  }

  // 0..1 through the whole job.
  getProgress() {
    const total = this.total();
    return total > 0 ? this.time / total : 0;
  }

  // The lineNumber of the segment most recently started (the one being drawn,
  // or the last one finished), or 0 when nothing has been drawn yet.
  getCurrentLine() {
    if (this.segments.length === 0) return 0;
    const touched = this.touchedIndex();
    return touched < 0 ? 0 : this.segments[touched].lineNumber;
  }

  // Replaces the toolpath and rewinds - a different file (or a re-fetch after
  // arming "run from") is a different playback.
  setSegments(segments: ToolpathSegment[], colorFor: SimulationColorFn) {
    this.segments = segments;
    this.colorFor = colorFor;
    this.playing = false;
    this.time = 0;
    this.computeTimes();
    this.speed = this.realTiming ? this.defaultRealSpeed() : QUICK_SPEEDS[1];
    this.markDirty();
  }

  // Recolors without disturbing playback (e.g. the "color by order" toggle).
  setColorFor(colorFor: SimulationColorFn) {
    this.colorFor = colorFor;
    this.markDirty();
  }

  // How fast rapids are assumed to travel, in mm/min. Keeps the playhead at the
  // same fraction of the job, since the total changes with it.
  setRapidRate(rapidRateMmPerMin: number) {
    if (!(rapidRateMmPerMin > 0) || rapidRateMmPerMin === this.rapidRate) return;
    this.rapidRate = rapidRateMmPerMin;
    if (!this.realTiming) return;
    const fraction = this.getProgress();
    this.computeTimes();
    this.time = fraction * this.total();
    this.renderedTime = -1;
    this.applyPlayhead();
  }

  // The "clean image" view draws only cutting moves; the tool marker still
  // travels the rapids so the motion stays continuous.
  setShowRapids(showRapids: boolean) {
    if (showRapids === this.showRapids) return;
    this.showRapids = showRapids;
    this.markDirty();
  }

  setActive(active: boolean) {
    this.active = active;
    this.group.visible = active;
    if (!active) this.playing = false;
    if (active) this.rebuildIfNeeded();
    this.renderedTime = -1;
    this.applyPlayhead();
  }

  play() {
    if (!this.active || this.segments.length === 0) return;
    // Pressing play at the end starts over rather than doing nothing.
    if (this.time >= this.total()) this.time = 0;
    this.playing = true;
  }

  pause() {
    this.playing = false;
  }

  restart() {
    this.time = 0;
    this.playing = false;
  }

  setSpeed(speed: number) {
    this.speed = speed;
  }

  seek(fraction: number) {
    this.time = Math.min(1, Math.max(0, fraction)) * this.total();
  }

  // Jumps to the end of the next line (or the end of the job).
  stepForward() {
    this.playing = false;
    const next = this.lineEnds.find((end) => end > this.time + 1e-9);
    this.time = next ?? this.total();
  }

  // Jumps to the end of the previous line (or the very start).
  stepBack() {
    this.playing = false;
    let previous = 0;
    for (const end of this.lineEnds) {
      if (end >= this.time - 1e-9) break;
      previous = end;
    }
    this.time = previous;
  }

  // Advances playback by real elapsed seconds and moves the visuals to match.
  // Returns true when anything visible changed, so the caller can refresh its
  // own UI state only when it needs to.
  update(deltaSeconds: number) {
    if (!this.active) return false;
    if (this.playing) {
      const total = this.total();
      const clockScale = this.realTiming ? 1 : total / BASE_DURATION_SECONDS;
      this.time += deltaSeconds * clockScale * this.speed;
      if (this.time >= total) {
        this.time = total;
        this.playing = false;
      }
    }
    return this.applyPlayhead();
  }

  dispose() {
    this.scene.remove(this.group);
    this.disposeGeometry();
    this.marker.geometry.dispose();
    (this.marker.material as THREE.Material).dispose();
    this.head.geometry.dispose();
    (this.head.material as THREE.Material).dispose();
  }

  private total() {
    return this.cumulative[this.cumulative.length - 1];
  }

  private defaultRealSpeed() {
    const total = this.total();
    return REAL_TIME_SPEEDS.find((speed) => total / speed <= TARGET_WATCH_SECONDS) ?? REAL_TIME_SPEEDS[REAL_TIME_SPEEDS.length - 1];
  }

  // Fills cumulative/lineEnds (and realTiming) from the segments and rapid rate.
  private computeTimes() {
    const segments = this.segments;
    const firstFeed = segments.find((segment) => !segment.rapid && (segment.feedRate ?? 0) > 0)?.feedRate ?? 0;
    this.realTiming = firstFeed > 0;

    const cumulative = new Float64Array(segments.length + 1);
    const lineEnds: number[] = [];
    segments.forEach((segment, i) => {
      const length = Math.hypot(
        segment.end.x - segment.start.x,
        segment.end.y - segment.start.y,
        segment.end.z - segment.start.z
      );
      let seconds: number;
      if (!this.realTiming) {
        seconds = length * (segment.rapid ? QUICK_RAPID_TIME_FACTOR : 1);
      } else if (segment.rapid) {
        // Coordinates are in the file's units; the rapid rate is in mm/min.
        seconds = ((length * (segment.inches ? MM_PER_INCH : 1)) / this.rapidRate) * 60;
      } else {
        // A cut before any F word was seen (invalid gcode, but the parser lets it
        // through) borrows the file's first feed rather than taking no time at all.
        const feed = (segment.feedRate ?? 0) > 0 ? segment.feedRate! : firstFeed;
        seconds = (length / feed) * 60;
      }
      cumulative[i + 1] = cumulative[i] + seconds;
      const isLastOfLine = i === segments.length - 1 || segments[i + 1].lineNumber !== segment.lineNumber;
      if (isLastOfLine) lineEnds.push(cumulative[i + 1]);
    });
    this.cumulative = cumulative;
    this.lineEnds = lineEnds;
  }

  // Number of segments fully drawn: the largest i with cumulative[i] <= time.
  private completedCount() {
    let low = 0;
    let high = this.segments.length;
    while (low < high) {
      const mid = (low + high + 1) >> 1;
      if (this.cumulative[mid] <= this.time) low = mid;
      else high = mid - 1;
    }
    return low;
  }

  // Index of the last segment that has started drawing, or -1 if none has. A
  // segment is "started" once the playhead is past its start (or it's finished),
  // so stopping exactly on a line boundary reports that line, not the next one.
  private touchedIndex() {
    const completed = this.completedCount();
    const inProgress = completed < this.segments.length && this.time > this.cumulative[completed];
    return inProgress ? completed : completed - 1;
  }

  private markDirty() {
    this.dirty = true;
    this.renderedTime = -1;
    if (this.active) this.rebuildIfNeeded();
    this.applyPlayhead();
  }

  private disposeGeometry() {
    for (const lines of [this.ghost, this.done]) {
      if (!lines) continue;
      this.group.remove(lines);
      lines.geometry.dispose();
      (lines.material as THREE.Material).dispose();
    }
    this.ghost = null;
    this.done = null;
  }

  private rebuildIfNeeded() {
    if (!this.dirty) return;
    this.dirty = false;
    this.disposeGeometry();
    this.visibleBefore = null;
    if (this.segments.length === 0) return;

    const positions = new Float32Array(this.segments.length * 6);
    const colors = new Float32Array(this.segments.length * 6);
    this.segments.forEach((segment, i) => {
      const offset = i * 6;
      positions[offset] = segment.start.x;
      positions[offset + 1] = segment.start.y;
      positions[offset + 2] = segment.start.z;
      positions[offset + 3] = segment.end.x;
      positions[offset + 4] = segment.end.y;
      positions[offset + 5] = segment.end.z;
      const color = this.colorFor(segment, i);
      colors[offset] = colors[offset + 3] = color.r;
      colors[offset + 1] = colors[offset + 4] = color.g;
      colors[offset + 2] = colors[offset + 5] = color.b;
    });
    const position = new THREE.BufferAttribute(positions, 3);
    const color = new THREE.BufferAttribute(colors, 3);

    // Rapids hidden: an index over just the cutting segments' vertices, in
    // program order, so drawRange still means "the first N visible segments".
    let index: THREE.BufferAttribute | null = null;
    if (!this.showRapids) {
      const visibleBefore = new Uint32Array(this.segments.length + 1);
      this.segments.forEach((segment, i) => {
        visibleBefore[i + 1] = visibleBefore[i] + (segment.rapid ? 0 : 1);
      });
      const indices = new Uint32Array(visibleBefore[this.segments.length] * 2);
      let n = 0;
      this.segments.forEach((segment, i) => {
        if (segment.rapid) return;
        indices[n++] = i * 2;
        indices[n++] = i * 2 + 1;
      });
      this.visibleBefore = visibleBefore;
      index = new THREE.BufferAttribute(indices, 1);
    }

    // Two geometries over the same attribute buffers: drawRange is a property of
    // the geometry, not the mesh, and the solid part needs its own.
    const ghostGeometry = new THREE.BufferGeometry();
    ghostGeometry.setAttribute("position", position);
    ghostGeometry.setAttribute("color", color);
    const doneGeometry = new THREE.BufferGeometry();
    doneGeometry.setAttribute("position", position);
    doneGeometry.setAttribute("color", color);
    if (index) {
      ghostGeometry.setIndex(index);
      doneGeometry.setIndex(index);
    }
    doneGeometry.setDrawRange(0, 0);

    this.ghost = new THREE.LineSegments(
      ghostGeometry,
      new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, opacity: GHOST_OPACITY, depthWrite: false })
    );
    this.done = new THREE.LineSegments(doneGeometry, new THREE.LineBasicMaterial({ vertexColors: true }));
    this.group.add(this.ghost, this.done);
  }

  // Moves the drawn range, the in-progress line and the marker to the current
  // time. Returns whether the time actually moved since the last call.
  private applyPlayhead() {
    if (this.time === this.renderedTime) return false;
    this.renderedTime = this.time;
    if (this.segments.length === 0 || !this.done) return true;

    const completed = this.completedCount();
    const drawn = this.visibleBefore ? this.visibleBefore[completed] : completed;
    this.done.geometry.setDrawRange(0, drawn * 2);

    const inProgress = completed < this.segments.length && this.time > this.cumulative[completed];
    if (inProgress) {
      const segment = this.segments[completed];
      const span = this.cumulative[completed + 1] - this.cumulative[completed];
      const f = span > 0 ? (this.time - this.cumulative[completed]) / span : 1;
      const x = segment.start.x + (segment.end.x - segment.start.x) * f;
      const y = segment.start.y + (segment.end.y - segment.start.y) * f;
      const z = segment.start.z + (segment.end.z - segment.start.z) * f;
      this.headPositions.set([segment.start.x, segment.start.y, segment.start.z, x, y, z]);
      (this.head.geometry.getAttribute("position") as THREE.BufferAttribute).needsUpdate = true;
      this.head.visible = this.showRapids || !segment.rapid;
      this.marker.position.set(x, y, z);
    } else {
      this.head.visible = false;
      const point = completed === 0 ? this.segments[0].start : this.segments[completed - 1].end;
      this.marker.position.set(point.x, point.y, point.z);
    }
    return true;
  }
}
