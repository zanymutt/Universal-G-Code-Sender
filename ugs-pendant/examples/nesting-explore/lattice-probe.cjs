// How dense could a repeating pattern (lattice) of one part be? Compared with what Engine B reaches
// for many copies, this says whether lattice/pair seeding is worth building.
//
//   node lattice-probe.cjs [--only=avakey,wedge] [--c=0.5]
//
// Method: column footprints (same model as the engine, dilated by gap/2 so touching = gap apart).
// Single: every translation lattice of one part. Pair: a part plus its half-turn twin placed against it,
// then every lattice of that pair. Density = part area per cell area, to be compared with B's
// "Used" for a long strip (edge losses make a finite nest a few percent lower than the lattice).
'use strict';
const fs = require('node:fs');
const Core = require('./core.js');
const B = require('./engine-b.js');
const S = require('./samples.cjs');

const args = Object.fromEntries(process.argv.slice(2).map(a => { const m = a.match(/^--([^=]+)=?(.*)$/); return m ? [m[1], m[2] || '1'] : []; }));
const only = args.only ? args.only.split(',') : null;
const c = Number(args.c) || 0.5;
const SHARE = '//MAIN-PC/05_network_shared_dup/plasma cnc/';
const real = {
  avakey: [SHARE + '1mm_noz/mckena/avakey_v3.gcode', 3], heart: [SHARE + '1mm_noz/ronan/yeheart2.gcode', 4],
  ram: [SHARE + '1mm_noz/ram dash mount/ramDashCut.gcode', 6], knife: [SHARE + 'drag knife/mckena/kena_red_v3_cut_.gcode', 4],
  bama: [SHARE + '1mm_noz/mckena/bamaA/svg2gcode4.gcode', 5], kena: [SHARE + '1mm_noz/mckena/kena.gcode', 4],
};
const synth = {
  wedge: [S.shapes.wedge(), 3], tri: [S.shapes.rightTriangle(), 3], trap: [S.shapes.trapezoid(), 3],
  L: [S.shapes.lShape(), 3], U: [S.shapes.uShape(), 3], C: [S.shapes.cShape(), 3], disc: [S.shapes.disc(25), 3],
};

// Forbidden dy for B translated by dx columns against A: union of open intervals.
function forbidden(fA, fB, dx) {
  const iv = [];
  for (let k = 0; k < fA.N; k++) {
    const kb = k - dx;
    if (kb < 0 || kb >= fB.N) continue;
    const ra = fA.runs[k], rb = fB.runs[kb];
    for (let a = 0; a < ra.length; a += 2) for (let b = 0; b < rb.length; b += 2) iv.push([ra[a] - rb[b + 1], ra[a + 1] - rb[b]]);
  }
  if (!iv.length) return [];
  iv.sort((p, q) => p[0] - q[0]);
  const out = [];
  let [lo, hi] = iv[0];
  for (let i = 1; i < iv.length; i++) {
    if (iv[i][0] < hi - 1e-9) { if (iv[i][1] > hi) hi = iv[i][1]; } else { out.push([lo, hi]); [lo, hi] = iv[i]; }
  }
  out.push([lo, hi]);
  return out;
}
const free = (M, dy) => M.every(([lo, hi]) => dy <= lo + 1e-6 || dy >= hi - 1e-6);

// Smallest cell of any lattice of footprint F (one F per cell). Returns { cell, u, v } in mm.
function bestLattice(F, keep = 90) {
  const cache = new Map();
  const M = dx => { let m = cache.get(dx); if (!m) { m = forbidden(F, F, dx); cache.set(dx, m); } return m; };
  const cand = [];
  for (let dx = 0; dx < F.N; dx++) {
    const m = M(dx);
    const ys = new Set();
    m.forEach(([lo, hi]) => { ys.add(lo); ys.add(hi); });
    for (const dy of ys) {
      if (!free(m, dy)) continue;
      if (dx === 0 && dy <= 1e-9) continue;
      cand.push({ dx, dy, len: Math.hypot(dx * c, dy) });
      if (dx > 0) { const m2 = M(-dx); if (free(m2, dy)) cand.push({ dx: -dx, dy, len: Math.hypot(dx * c, dy) }); }
    }
  }
  cand.sort((a, b) => a.len - b.len);
  const top = cand.slice(0, keep);
  let best = null;
  for (let i = 0; i < top.length; i++) {
    for (let j = i + 1; j < top.length; j++) {
      const u = top[i], v = top[j];
      const cross = Math.abs(u.dx * c * v.dy - u.dy * v.dx * c);
      if (cross < 1e-6 || (best && cross >= best.cell)) continue;
      let ok = true;
      for (let m = -2; m <= 2 && ok; m++) for (let n = -2; n <= 2 && ok; n++) {
        if (!m && !n) continue;
        const dx = m * u.dx + n * v.dx, dy = m * u.dy + n * v.dy;
        if (Math.abs(dx) >= F.N) continue;
        if (!free(M(dx), dy)) ok = false;
      }
      if (ok) best = { cell: cross, u, v };
    }
  }
  return best;
}

function compound(fP, fQ, dx, dy) {
  // Q placed dx columns to the right and dy up; columns are indexed from min(0, dx).
  const lo = Math.min(0, dx), hi = Math.max(fP.N, fQ.N + dx);
  const runs = [];
  for (let k = lo; k < hi; k++) {
    const list = [];
    if (k >= 0 && k < fP.N) for (let q = 0; q < fP.runs[k].length; q += 2) list.push([fP.runs[k][q], fP.runs[k][q + 1]]);
    const kq = k - dx;
    if (kq >= 0 && kq < fQ.N) for (let q = 0; q < fQ.runs[kq].length; q += 2) list.push([fQ.runs[kq][q] + dy, fQ.runs[kq][q + 1] + dy]);
    list.sort((a, b) => a[0] - b[0]);
    const m = [];
    for (const r of list) { if (m.length && r[0] <= m[m.length - 1][1] + 1e-9) m[m.length - 1][1] = Math.max(m[m.length - 1][1], r[1]); else m.push([r[0], r[1]]); }
    runs.push(m.flat());
  }
  return { N: runs.length, runs };
}

function probe(name, text, gap) {
  const src = Core.extract(text);
  const R = gap / 2 + Core.FLAT_TOL;
  const prep = B.prepare([src], { counts: [1], rotate: true, rotStep: 15, mirror: { x: false, y: false } });
  const area = Core.unionArea(src.outline) * src.mmPerUnit * src.mmPerUnit;
  const byAngle = new Map(prep.orients.map(o => [Math.round(o.angle * 100) / 100, o]));
  let single = null, pair = null;
  for (const o of prep.orients) {
    const F = B.footprint(o, false, c, R);
    if (F.N > 400) continue;
    const s = bestLattice(F);
    if (s && (!single || s.cell < single.cell)) single = { ...s, angle: o.angle };
    const twin = byAngle.get(Math.round(((o.angle + 180) % 360) * 100) / 100);
    if (!twin) continue;
    const G = B.footprint(twin, false, c, R);
    // placements of the twin against the part: touching translations, shortest first
    const spots = [];
    for (let dx = -(G.N - 1); dx < F.N; dx++) {
      const m = forbidden(F, G, dx);
      const ys = new Set();
      m.forEach(([lo, hi]) => { ys.add(lo); ys.add(hi); });
      for (const dy of ys) if (free(m, dy)) spots.push({ dx, dy, len: Math.hypot((dx + (G.N - F.N) / 2) * c, dy + 0) });
    }
    spots.sort((a, b) => a.len - b.len);
    for (const w of spots.slice(0, 14)) {
      const K = compound(F, G, w.dx, w.dy);
      const p = bestLattice(K, 70);
      if (p && (!pair || p.cell / 2 < pair.cell)) pair = { cell: p.cell / 2, angle: o.angle, w };
    }
  }
  const dens = cell => (cell ? area / cell : NaN);
  return { name, area, single: single && { density: dens(single.cell), angle: single.angle }, pair: pair && { density: dens(pair.cell), angle: pair.angle } };
}

const rows = [];
const entries = [...Object.entries(real).map(([k, [p, g]]) => [k, fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : null, g]), ...Object.entries(synth).map(([k, [t, g]]) => [k, t, g])];
for (const [name, text, gap] of entries) {
  if (only && !only.includes(name)) continue;
  if (!text) { console.log(`SKIP ${name}`); continue; }
  const t0 = Date.now();
  const r = probe(name, text, gap);
  rows.push(r);
  console.log(`${name.padEnd(8)} part ${r.area.toFixed(0).padStart(6)} mm2  best single-part lattice ${(r.single?.density * 100).toFixed(1)}% @${r.single?.angle}°   best twin-pair lattice ${(r.pair?.density * 100).toFixed(1)}% @${r.pair?.angle}°   (${((Date.now() - t0) / 1000).toFixed(1)} s)`);
}
