import * as THREE from "three";
import { IDLE_STOCK_STATUS, StockStatus } from "./stockModel";
import {
  autoPlotterCell,
  NO_PEN_COLOR,
  PaperPlan,
  PenStyle,
  planPaper,
  PlotterOptions,
  scanInk,
} from "./plotterEngine";
import { packToolpath, PackedToolpath, StockSettings } from "./stockSimEngine";

// The plotter view's sheet of paper, drawn in the visualizer scene: a flat plane textured with a
// picture that the pen strokes are painted into as the playhead (or the job) moves along the file.
// The picture is small enough to paint on the main thread, so there is no worker; going forward only
// paints the new segments, going back clears the sheet and repaints up to the new point.

type ToolpathLike = Parameters<typeof packToolpath>[0];

export class PlotterModel {
  private readonly group = new THREE.Group();
  private enabled = false;
  private packed: PackedToolpath | null = null;
  private ink: Uint8Array | null = null;
  private plan: PaperPlan | null = null;
  private pens: Record<number, PenStyle> = {};
  private fallbackPen: PenStyle = { color: NO_PEN_COLOR, width: 0.5 };
  private paperColor = "#ffffff";
  private unit = 1;
  // The paper as painted so far (committed), and the picture the plane shows: the paper plus the
  // part of the stroke being drawn right now.
  private paper: HTMLCanvasElement | null = null;
  private shown: HTMLCanvasElement | null = null;
  private texture: THREE.CanvasTexture | null = null;
  private committed = 0;
  private wantCount = Number.POSITIVE_INFINITY;
  private wantFraction = 0;
  private shownKey = "";
  private mesh: THREE.Mesh | null = null;
  private edge: THREE.LineSegments | null = null;

  constructor(
    private readonly scene: THREE.Scene,
    private readonly onStatus: (status: StockStatus) => void
  ) {
    this.group.visible = false;
    scene.add(this.group);
  }

  setEnabled(enabled: boolean) {
    this.enabled = enabled;
    this.group.visible = enabled && this.plan !== null;
    if (!enabled) this.clear();
  }

  // Lays out the paper for this toolpath and paints it up to the current point. Cheap to call again
  // for any change of pen, paper or settings. `settings.diameter` is the width of a pen the file
  // doesn't describe, `topZ` the paper surface and `margin` the border of a "fit the drawing" sheet.
  load(
    segments: ToolpathLike,
    settings: StockSettings,
    options: PlotterOptions,
    segmentTools: Int32Array | undefined,
    pens: Record<number, PenStyle>
  ) {
    this.clear();
    if (!this.enabled || segments.length === 0) {
      this.onStatus({ ...IDLE_STOCK_STATUS });
      return;
    }
    const packed = packToolpath(segments, segmentTools);
    const scanned = scanInk(packed, settings.topZ);
    this.unit = packed.inches ? 25.4 : 1;
    if (!scanned.bounds) {
      this.onStatus({ ...IDLE_STOCK_STATUS, state: "empty", inches: packed.inches });
      return;
    }
    const cell = settings.cell > 0 ? settings.cell : autoPlotterCell(Object.values(pens).map((pen) => pen.width), settings.diameter);
    const plan = planPaper(scanned.bounds, settings.margin, options, cell, settings.maxCells);

    const paper = document.createElement("canvas");
    paper.width = plan.cols;
    paper.height = plan.rows;
    const shown = document.createElement("canvas");
    shown.width = plan.cols;
    shown.height = plan.rows;
    if (!paper.getContext("2d") || !shown.getContext("2d")) {
      this.onStatus({ ...IDLE_STOCK_STATUS, state: "error" });
      return;
    }

    this.packed = packed;
    this.ink = scanned.ink;
    this.plan = plan;
    this.pens = pens;
    this.fallbackPen = { color: NO_PEN_COLOR, width: settings.diameter };
    this.paperColor = options.paperColor;
    this.paper = paper;
    this.shown = shown;
    this.committed = 0;
    this.shownKey = "";
    this.fillPaper();

    const texture = new THREE.CanvasTexture(shown);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.generateMipmaps = false;
    texture.minFilter = THREE.LinearFilter;
    texture.magFilter = THREE.LinearFilter;
    this.texture = texture;

    const width = plan.width / this.unit;
    const height = plan.height / this.unit;
    const z = settings.topZ / this.unit;
    // The pen-down lines of the toolpath sit at (and below) the paper surface, so the sheet must not
    // hide them: it is drawn first and leaves the depth buffer alone.
    const material = new THREE.MeshBasicMaterial({ map: texture, depthWrite: false });
    const geometry = new THREE.PlaneGeometry(width, height);
    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.set(plan.x / this.unit + width / 2, plan.y / this.unit + height / 2, z);
    mesh.renderOrder = -1;
    this.mesh = mesh;
    const edge = new THREE.LineSegments(
      new THREE.EdgesGeometry(geometry),
      new THREE.LineBasicMaterial({ color: "#7a7f87", depthWrite: false })
    );
    edge.position.copy(mesh.position);
    edge.renderOrder = -1;
    this.edge = edge;
    this.group.add(mesh, edge);
    this.group.visible = this.enabled;

    this.onStatus({
      ...IDLE_STOCK_STATUS,
      state: "ready",
      coarsened: plan.coarsened,
      cell: 1 / plan.pxPerMm / this.unit,
      inches: packed.inches,
    });
    this.apply();
  }

  // Shows the sheet as it is after `segments` segments have run, plus the first `fraction` (0..1) of
  // the one being drawn now.
  setProgress(segments: number, fraction = 0) {
    this.wantCount = segments;
    this.wantFraction = fraction;
    this.apply();
  }

  dispose() {
    this.clear();
    this.scene.remove(this.group);
  }

  private clear() {
    this.group.visible = false;
    for (const object of [this.mesh, this.edge]) {
      if (!object) continue;
      this.group.remove(object);
      object.geometry.dispose();
      (object.material as THREE.Material).dispose();
    }
    this.mesh = null;
    this.edge = null;
    this.texture?.dispose();
    this.texture = null;
    this.paper = null;
    this.shown = null;
    this.packed = null;
    this.ink = null;
    this.plan = null;
    this.committed = 0;
    this.shownKey = "";
  }

  private fillPaper() {
    const ctx = this.paper?.getContext("2d");
    if (!ctx || !this.paper) return;
    ctx.fillStyle = this.paperColor;
    ctx.fillRect(0, 0, this.paper.width, this.paper.height);
  }

  private apply() {
    const { packed, ink, plan, paper, shown, texture } = this;
    if (!packed || !ink || !plan || !paper || !shown || !texture) return;
    const total = packed.rapid.length;
    const count = Math.max(0, Math.min(total, Math.floor(this.wantCount)));
    const fraction = count < total && ink[count] === 1 ? Math.min(1, Math.max(0, this.wantFraction)) : 0;
    const key = `${count}:${fraction}`;
    if (key === this.shownKey) return;

    const paperCtx = paper.getContext("2d");
    const shownCtx = shown.getContext("2d");
    if (!paperCtx || !shownCtx) return;
    if (count < this.committed) {
      this.fillPaper();
      this.committed = 0;
    }
    for (let i = this.committed; i < count; i++) if (ink[i] === 1) this.stroke(paperCtx, i, 1);
    this.committed = count;

    shownCtx.drawImage(paper, 0, 0);
    if (fraction > 0) this.stroke(shownCtx, count, fraction);
    texture.needsUpdate = true;
    this.shownKey = key;
  }

  // One pen stroke, or the first `part` (0..1) of it.
  private stroke(ctx: CanvasRenderingContext2D, index: number, part: number) {
    const { packed, plan } = this;
    if (!packed || !plan) return;
    const tool = packed.tool[index];
    const pen = (tool >= 0 ? this.pens[tool] : undefined) ?? this.fallbackPen;
    const o = index * 6;
    const c = packed.coords;
    const px = (x: number) => (x * this.unit - plan.x) * plan.pxPerMm;
    const py = (y: number) => (plan.height - (y * this.unit - plan.y)) * plan.pxPerMm;
    ctx.strokeStyle = pen.color;
    ctx.lineWidth = Math.max(1, pen.width * plan.pxPerMm);
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.beginPath();
    ctx.moveTo(px(c[o]), py(c[o + 1]));
    ctx.lineTo(px(c[o] + (c[o + 3] - c[o]) * part), py(c[o + 1] + (c[o + 4] - c[o + 1]) * part));
    ctx.stroke();
  }
}
