import * as THREE from "three";
import { MAX_TOOL_SLOTS, packToolpath, StockGrid, StockSettings } from "./stockSimEngine";
import type { StockWorkerRequest, StockWorkerResponse } from "./stockSim.worker";

// The simulated block of material, drawn in the visualizer scene. The heightfield
// itself is computed in a Web Worker (stockSim.worker.ts); this class owns the
// worker, a static grid mesh, and a height texture the vertex shader displaces
// that mesh with - so a new result is one texture upload, not a rebuild of a
// million vertices and their normals.

export type StockStatus = {
  state: "idle" | "computing" | "ready" | "empty" | "error";
  // 0..1 through the segments that still need stamping, while computing.
  progress: number;
  coarsened: boolean;
  cell: number;
  inches: boolean;
  // Rapid moves, so far, that cut into material: how many, and the segment
  // indices of the first few (into the toolpath that was loaded).
  rapidCount: number;
  rapidFirst: number[];
};

export const IDLE_STOCK_STATUS: StockStatus = {
  state: "idle",
  progress: 0,
  coarsened: false,
  cell: 0,
  inches: false,
  rapidCount: 0,
  rapidFirst: [],
};

type ToolpathLike = Parameters<typeof packToolpath>[0];

const VERTEX_SHADER = /* glsl */ `
  uniform sampler2D uHeights;
  uniform vec2 uOrigin;
  uniform float uCell;
  uniform ivec2 uGrid;
  uniform float uBottom;
  attribute float aSide;
  varying vec2 vCell;
  varying float vShade;

  ivec2 cellOf(vec2 xy) {
    vec2 c = floor((xy - uOrigin) / uCell + 0.5);
    return clamp(ivec2(c), ivec2(0), uGrid - ivec2(1));
  }

  void main() {
    ivec2 cell = cellOf(position.xy);
    float h = texelFetch(uHeights, cell, 0).r;
    float z = h;
    vShade = 1.0;
    #ifdef SKIRT
      // position.z is 0 on the upper edge and 1 on the lower; aSide picks the wall's shade.
      z = position.z > 0.5 ? uBottom : h;
      vShade = aSide;
    #endif
    vCell = vec2(cell);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position.xy, z, 1.0);
  }
`;

const FRAGMENT_SHADER = /* glsl */ `
  uniform sampler2D uHeights;
  uniform ivec2 uGrid;
  uniform float uCell;
  uniform float uTop;
  uniform float uBottom;
  uniform float uBurn;
  uniform vec3 uTopColor;
  uniform vec3 uDeepColor;
  uniform vec3 uSideColor;
  uniform vec3 uBurnColor;
  uniform vec3 uLight;
  uniform sampler2D uOwner;
  uniform float uTint;
  uniform vec3 uToolColors[${MAX_TOOL_SLOTS + 1}];
  varying vec2 vCell;
  varying float vShade;

  float heightAt(ivec2 c) {
    return texelFetch(uHeights, clamp(c, ivec2(0), uGrid - ivec2(1)), 0).r;
  }

  void main() {
    #ifdef SKIRT
      gl_FragColor = vec4(uSideColor * vShade, 1.0);
    #else
      ivec2 c = ivec2(vCell + 0.5);
      float h = heightAt(c);
      // Cut clean through: nothing there, so let the background show.
      if (h <= uBottom + 1e-5) discard;
      float dx = (heightAt(c + ivec2(1, 0)) - heightAt(c - ivec2(1, 0))) / (2.0 * uCell);
      float dy = (heightAt(c + ivec2(0, 1)) - heightAt(c - ivec2(0, 1))) / (2.0 * uCell);
      vec3 n = normalize(vec3(-dx, -dy, 1.0));
      float depth = clamp((uTop - h) / max(uTop - uBottom, 1e-6), 0.0, 1.0);
      vec3 base = mix(uTopColor, uDeepColor, depth * 0.85);
      // Laser engraving chars the wood: darken anything below the surface.
      // The deeper the burn, the darker: a light scorch up to near-black.
      float cut = uTop - h;
      float burnt = uBurn * step(1e-4, cut) * (0.35 + 0.65 * clamp(cut / max(0.5 * (uTop - uBottom), 1e-6), 0.0, 1.0));
      base = mix(base, uBurnColor, burnt * 0.9);
      // Several tools: tint what each one cut in that tool's color.
      if (uTint > 0.5 && cut > 1e-4) {
        int slot = int(texelFetch(uOwner, c, 0).r * 255.0 + 0.5);
        if (slot > 0) base = mix(base, uToolColors[slot], 0.6);
      }
      float light = 0.38 + 0.75 * max(dot(n, normalize(uLight)), 0.0);
      gl_FragColor = vec4(base * light, 1.0);
    #endif
  }
`;

const TOP_COLOR = new THREE.Color("#d9b27c");
const DEEP_COLOR = new THREE.Color("#8a5a2b");
const SIDE_COLOR = new THREE.Color("#b88a52");
const BURN_COLOR = new THREE.Color("#2a1a0e");

export class StockModel {
  private readonly group = new THREE.Group();
  private worker: Worker | null = null;
  private jobId = 0;
  private grid: StockGrid | null = null;
  private segmentCount = 0;
  private wantIndex = 0;
  private wantFraction = 0;
  private inFlight = false;
  private sentKey = "";
  private heights: THREE.DataTexture | null = null;
  private ownerTexture: THREE.DataTexture | null = null;
  private uniforms: Record<string, THREE.IUniform> | null = null;
  // Tool numbers in slot order (slot n + 1 = toolNumbers[n]); the colors to
  // draw them in; and whether the cut is tinted at all.
  private toolNumbers: number[] = [];
  private toolColors: Record<number, string> = {};
  private tint = false;
  private surface: THREE.Mesh | null = null;
  private skirt: THREE.Mesh | null = null;
  private status: StockStatus = IDLE_STOCK_STATUS;
  private burn = 0;
  private enabled = false;

  constructor(
    private readonly scene: THREE.Scene,
    private readonly onStatus: (status: StockStatus) => void
  ) {
    this.group.visible = false;
    scene.add(this.group);
  }

  setEnabled(enabled: boolean) {
    this.enabled = enabled;
    this.group.visible = enabled && this.grid !== null;
    if (!enabled) this.stopWorker();
  }

  // Starts (or restarts) a simulation of this toolpath. Cheap to call again
  // for settings changes: the previous job is abandoned.
  load(segments: ToolpathLike, settings: StockSettings, segmentTools?: Int32Array) {
    this.stopWorker();
    this.clearMeshes();
    this.grid = null;
    this.group.visible = false;
    if (!this.enabled || segments.length === 0) {
      this.setStatus({ ...IDLE_STOCK_STATUS });
      return;
    }
    let worker: Worker;
    try {
      worker = new Worker(new URL("./stockSim.worker.ts", import.meta.url), { type: "module" });
    } catch {
      this.setStatus({ ...IDLE_STOCK_STATUS, state: "error" });
      return;
    }
    this.worker = worker;
    this.jobId += 1;
    const jobId = this.jobId;
    this.burn = settings.process === "laser" ? 1 : 0;
    this.inFlight = false;
    this.sentKey = "";
    const packed = packToolpath(segments, segmentTools);
    this.setStatus({ ...IDLE_STOCK_STATUS, state: "computing", inches: packed.inches });
    worker.onmessage = (event: MessageEvent<StockWorkerResponse>) => this.receive(jobId, event.data);
    worker.onerror = () => this.setStatus({ ...this.status, state: "error" });
    const request: StockWorkerRequest = { type: "load", jobId, packed, settings };
    worker.postMessage(request, [packed.coords.buffer, packed.rapid.buffer, packed.power.buffer, packed.tool.buffer]);
  }

  // Which colors to draw each tool's cut in, and whether to tint at all. Only
  // changes how the finished result is painted, so it never restarts the
  // simulation.
  setToolColors(colors: Record<number, string>, tint: boolean) {
    this.toolColors = colors;
    this.tint = tint;
    this.applyToolColors();
  }

  // Shows the stock as it is after `segments` toolpath segments have run, plus
  // the first `fraction` (0..1) of the one being cut now.
  setProgress(segments: number, fraction = 0) {
    this.wantIndex = segments;
    this.wantFraction = fraction;
    this.requestIfNeeded();
  }

  dispose() {
    this.stopWorker();
    this.clearMeshes();
    this.scene.remove(this.group);
  }

  private setStatus(status: StockStatus) {
    this.status = status;
    this.onStatus(status);
  }

  private stopWorker() {
    this.worker?.terminate();
    this.worker = null;
    this.jobId += 1;
  }

  private requestIfNeeded() {
    if (!this.worker || !this.grid || this.inFlight) return;
    const index = Math.max(0, Math.min(this.segmentCount, Math.floor(this.wantIndex)));
    const fraction = Math.max(0, Math.min(1, this.wantFraction));
    const key = `${index}:${fraction}`;
    if (key === this.sentKey) return;
    this.sentKey = key;
    this.inFlight = true;
    const request: StockWorkerRequest = { type: "seek", jobId: this.jobId, index, fraction };
    this.worker.postMessage(request);
  }

  private receive(jobId: number, message: StockWorkerResponse) {
    if (jobId !== this.jobId || message.jobId !== jobId) return;
    switch (message.type) {
      case "empty":
        this.setStatus({ ...this.status, state: "empty" });
        break;
      case "ready":
        this.grid = message.grid;
        this.segmentCount = message.segmentCount;
        this.toolNumbers = message.toolNumbers;
        this.buildMeshes(message.grid);
        this.setStatus({
          ...this.status,
          state: "computing",
          coarsened: message.grid.coarsened,
          cell: message.grid.cell,
        });
        this.requestIfNeeded();
        break;
      case "progress":
        this.setStatus({
          ...this.status,
          state: "computing",
          progress: message.target > 0 ? message.index / message.target : 0,
        });
        break;
      case "heights":
        this.applyHeights(message.heights, message.owner);
        if (message.done) {
          this.inFlight = false;
          this.setStatus({
            ...this.status,
            state: "ready",
            progress: 1,
            rapidCount: message.rapidHits.count,
            rapidFirst: message.rapidHits.first,
          });
          // The position moved on while that was computing.
          this.requestIfNeeded();
        }
        break;
    }
  }

  private applyToolColors() {
    const uniforms = this.uniforms;
    if (!uniforms) return;
    const colors = uniforms.uToolColors.value as THREE.Vector3[];
    const scratch = new THREE.Color();
    colors.forEach((slot) => slot.set(0, 0, 0));
    // A tool with no color (deleted from the table) is drawn in the wood's own
    // color, i.e. not tinted.
    this.toolNumbers.forEach((tool, n) => {
      const hex = this.toolColors[tool];
      if (hex) scratch.set(hex);
      else scratch.copy(TOP_COLOR);
      colors[Math.min(n + 1, MAX_TOOL_SLOTS)].set(scratch.r, scratch.g, scratch.b);
    });
    uniforms.uTint.value = this.tint && this.toolNumbers.length >= 2 ? 1 : 0;
  }

  private applyHeights(heights: Float32Array, owner: Uint8Array | null) {
    const texture = this.heights;
    if (!texture) return;
    texture.image.data = heights;
    texture.needsUpdate = true;
    const ownerTexture = this.ownerTexture;
    if (owner && ownerTexture && (ownerTexture.image.data?.length ?? 0) === owner.length) {
      ownerTexture.image.data = owner;
      ownerTexture.needsUpdate = true;
    }
    this.group.visible = this.enabled;
  }

  private clearMeshes() {
    for (const mesh of [this.surface, this.skirt]) {
      if (!mesh) continue;
      this.group.remove(mesh);
      mesh.geometry.dispose();
      (mesh.material as THREE.Material).dispose();
    }
    this.surface = null;
    this.skirt = null;
    this.heights?.dispose();
    this.heights = null;
    this.ownerTexture?.dispose();
    this.ownerTexture = null;
    this.uniforms = null;
  }

  private buildMeshes(grid: StockGrid) {
    this.clearMeshes();
    const { nx, ny, ox, oy, cell, top, bottom } = grid;

    const initial = new Float32Array(nx * ny);
    initial.fill(top);
    const texture = new THREE.DataTexture(initial, nx, ny, THREE.RedFormat, THREE.FloatType);
    texture.minFilter = THREE.NearestFilter;
    texture.magFilter = THREE.NearestFilter;
    texture.generateMipmaps = false;
    texture.needsUpdate = true;
    this.heights = texture;

    // Which tool cut each sample: a full-size map only when the file has two or
    // more tools, else a single texel the shader never reads.
    const tools = this.toolNumbers.length >= 2;
    const ownerTexture = new THREE.DataTexture(
      new Uint8Array(tools ? nx * ny : 1),
      tools ? nx : 1,
      tools ? ny : 1,
      THREE.RedFormat,
      THREE.UnsignedByteType
    );
    ownerTexture.minFilter = THREE.NearestFilter;
    ownerTexture.magFilter = THREE.NearestFilter;
    ownerTexture.generateMipmaps = false;
    ownerTexture.unpackAlignment = 1;
    ownerTexture.needsUpdate = true;
    this.ownerTexture = ownerTexture;

    const uniforms: Record<string, THREE.IUniform> = {
      uHeights: { value: texture },
      uOrigin: { value: new THREE.Vector2(ox, oy) },
      uCell: { value: cell },
      uGrid: { value: new THREE.Vector2(nx, ny) },
      uTop: { value: top },
      uBottom: { value: bottom },
      uBurn: { value: this.burn },
      uTopColor: { value: new THREE.Vector3(TOP_COLOR.r, TOP_COLOR.g, TOP_COLOR.b) },
      uDeepColor: { value: new THREE.Vector3(DEEP_COLOR.r, DEEP_COLOR.g, DEEP_COLOR.b) },
      uSideColor: { value: new THREE.Vector3(SIDE_COLOR.r, SIDE_COLOR.g, SIDE_COLOR.b) },
      uBurnColor: { value: new THREE.Vector3(BURN_COLOR.r, BURN_COLOR.g, BURN_COLOR.b) },
      uLight: { value: new THREE.Vector3(-0.45, -0.55, 0.85) },
      uOwner: { value: ownerTexture },
      uTint: { value: 0 },
      uToolColors: { value: Array.from({ length: MAX_TOOL_SLOTS + 1 }, () => new THREE.Vector3()) },
    };
    this.uniforms = uniforms;
    this.applyToolColors();
    // Surface: one vertex per sample, only (x, y) stored - the shader supplies z.
    const positions = new Float32Array(nx * ny * 2);
    for (let j = 0; j < ny; j++) {
      for (let i = 0; i < nx; i++) {
        const k = (j * nx + i) * 2;
        positions[k] = ox + i * cell;
        positions[k + 1] = oy + j * cell;
      }
    }
    const indexCount = (nx - 1) * (ny - 1) * 6;
    const indices = new Uint32Array(indexCount);
    let n = 0;
    for (let j = 0; j < ny - 1; j++) {
      for (let i = 0; i < nx - 1; i++) {
        const a = j * nx + i;
        const b = a + 1;
        const c = a + nx;
        const d = c + 1;
        indices[n++] = a;
        indices[n++] = b;
        indices[n++] = c;
        indices[n++] = b;
        indices[n++] = d;
        indices[n++] = c;
      }
    }
    const surfaceGeometry = new THREE.BufferGeometry();
    surfaceGeometry.setAttribute("position", new THREE.BufferAttribute(positions, 2));
    surfaceGeometry.setIndex(new THREE.BufferAttribute(indices, 1));
    // The vertices carry no z (the shader supplies it), so three can't derive
    // bounds from them - give it the block's own sphere.
    const halfX = ((nx - 1) * cell) / 2;
    const halfY = ((ny - 1) * cell) / 2;
    surfaceGeometry.boundingSphere = new THREE.Sphere(
      new THREE.Vector3(ox + halfX, oy + halfY, (top + bottom) / 2),
      Math.hypot(halfX, halfY, (top - bottom) / 2)
    );
    const surfaceMaterial = new THREE.ShaderMaterial({
      uniforms,
      vertexShader: VERTEX_SHADER,
      fragmentShader: FRAGMENT_SHADER,
      side: THREE.DoubleSide,
      // Keep the toolpath lines drawn on the surface (and at the bottom of a
      // cut) from z-fighting with it.
      polygonOffset: true,
      polygonOffsetFactor: 1,
      polygonOffsetUnits: 1,
    });
    this.surface = new THREE.Mesh(surfaceGeometry, surfaceMaterial);
    this.surface.frustumCulled = false;
    this.group.add(this.surface);

    // Skirt: the four side walls, from the surface's edge samples down to the bottom.
    const edge: { x: number; y: number; shade: number }[][] = [[], [], [], []];
    for (let i = 0; i < nx; i++) {
      edge[0].push({ x: ox + i * cell, y: oy, shade: 0.72 });
      edge[1].push({ x: ox + i * cell, y: oy + (ny - 1) * cell, shade: 0.58 });
    }
    for (let j = 0; j < ny; j++) {
      edge[2].push({ x: ox, y: oy + j * cell, shade: 0.66 });
      edge[3].push({ x: ox + (nx - 1) * cell, y: oy + j * cell, shade: 0.8 });
    }
    const wallPositions: number[] = [];
    const wallSides: number[] = [];
    const wallIndices: number[] = [];
    edge.forEach((strip) => {
      const base = wallPositions.length / 3;
      strip.forEach((point) => {
        wallPositions.push(point.x, point.y, 0, point.x, point.y, 1);
        wallSides.push(point.shade, point.shade);
      });
      for (let i = 0; i < strip.length - 1; i++) {
        const a = base + i * 2;
        wallIndices.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
      }
    });
    const skirtGeometry = new THREE.BufferGeometry();
    skirtGeometry.setAttribute("position", new THREE.Float32BufferAttribute(wallPositions, 3));
    skirtGeometry.setAttribute("aSide", new THREE.Float32BufferAttribute(wallSides, 1));
    skirtGeometry.setIndex(wallIndices);
    const skirtMaterial = new THREE.ShaderMaterial({
      uniforms,
      defines: { SKIRT: "" },
      vertexShader: VERTEX_SHADER,
      fragmentShader: FRAGMENT_SHADER,
      side: THREE.DoubleSide,
    });
    this.skirt = new THREE.Mesh(skirtGeometry, skirtMaterial);
    this.skirt.frustumCulled = false;
    this.group.add(this.skirt);
  }
}
