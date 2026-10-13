// Nesting Explore - Engine B.
//
// An alternative packer for the Nesting plugin's parsed parts. Parsing, G-code generation, origin
// handling and the cut-order planner are the unmodified Engine A code in core.js; only the part that
// decides where each copy goes lives here, so A and B can be compared on identical inputs.
//
// What is different from Engine A (see README.md for the reasoning):
//   * footprints are a list of vertical runs per x-column instead of one [lowest, highest] pair, so a
//     part can sit in another part's notch, and (optionally) inside its holes;
//   * extra rotation candidates: the angles that lay each long edge of the part's convex hull flat
//     against a strip side, on top of the user's step grid;
//   * construction is followed by a time-budgeted shrink loop (remove the parts sticking out past a
//     slightly shorter limit and a few neighbours, re-insert them, keep the result when everything fits);
//   * the origin corner is handled by mirroring the geometry, solving bottom-left and mirroring back,
//     so the packer itself has no corner special cases.
(function (root) {
  'use strict';
  const Core = typeof module !== 'undefined' && module.exports ? require('./core.js') : root.NestCore;
  const { FLAT_TOL, polyArea, pointInPoly } = Core;

  // ---------------------------------------------------------------- small helpers
  function rng(seed) {
    let s = (seed >>> 0) || 1;
    return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; };
  }
  const normAngle = a => { let v = a % 360; if (v < 0) v += 360; return Math.round(v * 1e6) / 1e6 % 360; };
  function boxOf(points) {
    const b = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
    for (const p of points) {
      if (p.x < b.minX) b.minX = p.x; if (p.x > b.maxX) b.maxX = p.x;
      if (p.y < b.minY) b.minY = p.y; if (p.y > b.maxY) b.maxY = p.y;
    }
    return b;
  }
  const ringKey = c => `${c.pts.length}|${Math.round(c.area * 1000)}|${Math.round((c.bbox.minX + c.bbox.maxX) * 500)}|${Math.round((c.bbox.minY + c.bbox.maxY) * 500)}`;
  // Same containment rule extract() uses for 'top': bbox inside, and 80% of sample points inside.
  function contains(o, c) {
    if (o.area <= c.area) return false;
    if (c.bbox.minX < o.bbox.minX - 1e-9 || c.bbox.maxX > o.bbox.maxX + 1e-9 || c.bbox.minY < o.bbox.minY - 1e-9 || c.bbox.maxY > o.bbox.maxY + 1e-9) return false;
    const step = Math.max(1, Math.floor(c.pts.length / 20));
    let n = 0, inside = 0;
    for (let i = 0; i < c.pts.length; i += step) { n++; if (pointInPoly(c.pts[i], o.pts)) inside++; }
    return inside >= n * 0.8;
  }

  // ---------------------------------------------------------------- shapes
  // A region is one outer contour plus (in hole mode) the rings inside it, filled even-odd: material is
  // outer minus holes plus islands. Regions of a part are unioned. Without holes a region is its outer
  // contour alone, so the footprint is the plain outline exactly as in Engine A.
  function sourceRegions(source, holes, thrFileUnits2) {
    const seen = new Set();
    const tops = source.contours.filter(c => c.top).filter(c => { const k = ringKey(c); if (seen.has(k)) return false; seen.add(k); return true; });
    if (!holes) return tops.map(t => { const r = [t.pts]; r.blocks = [t.block]; return r; });
    const others = source.contours.filter(c => !c.top && c.pts.length >= 3 && c.area > 1e-9);
    return tops.map(t => {
      const keys = new Set();
      const rings = [t];
      others.filter(o => contains(t, o)).sort((a, b) => b.area - a.area).forEach(o => {
        const k = ringKey(o);
        if (!keys.has(k)) { keys.add(k); rings.push(o); }
      });
      const kept = [t.pts];
      const blocks = [t.block];
      const keptFlag = [true];
      for (let i = 1; i < rings.length; i++) {
        let depth = 0, parent = 0;
        for (let j = 0; j < i; j++) if (contains(rings[j], rings[i])) { depth++; parent = j; }
        // A hole too small to hold the smallest part is left as material (safe). An island is only
        // meaningful inside a hole that was kept; otherwise it is already material.
        const keep = depth % 2 === 1 ? rings[i].area >= thrFileUnits2 : keptFlag[parent] && depth > 1;
        keptFlag[i] = keep;
        if (keep) { kept.push(rings[i].pts); blocks.push(rings[i].block); }
      }
      kept.blocks = blocks;
      return kept;
    });
  }

  function hullAngles(outers, count) {
    const pts = outers.flat().map(p => ({ x: p.x, y: p.y })).sort((a, b) => a.x - b.x || a.y - b.y);
    if (pts.length < 3) return [];
    const cross = (o, a, b) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
    const lower = [], upper = [];
    for (const p of pts) { while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) lower.pop(); lower.push(p); }
    for (let i = pts.length - 1; i >= 0; i--) { const p = pts[i]; while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) upper.pop(); upper.push(p); }
    const hull = lower.slice(0, -1).concat(upper.slice(0, -1));
    const edges = hull.map((a, i) => { const b = hull[(i + 1) % hull.length]; return { len: Math.hypot(b.x - a.x, b.y - a.y), ang: Math.atan2(b.y - a.y, b.x - a.x) * 180 / Math.PI }; });
    edges.sort((a, b) => b.len - a.len);
    const out = [];
    for (const e of edges.slice(0, count)) for (let q = 0; q < 4; q++) out.push(normAngle(-e.ang + 90 * q));
    return out;
  }

  // mirror = { x, y }: reflect the geometry about the part centre before solving; see mapBack().
  function prepare(sources, opts) {
    const holes = !!opts.holes;
    const counts = opts.counts.map(v => Math.floor(Number(v)));
    const mirror = opts.mirror || { x: false, y: false };
    // Smallest part area among the files: a hole smaller than that cannot hold any copy.
    const outlineAreas = sources.map(s => Core.unionArea(s.outline) * s.mmPerUnit * s.mmPerUnit);
    const minArea = Math.min(...outlineAreas);
    const grid = [0];
    if (opts.rotate) {
      const step = Number(opts.rotStep);
      if (!(step > 0 && step <= 180)) throw Error('Rotation step must be between 0 and 180 degrees.');
      for (let a = step; a < 360 - 1e-9; a += step) grid.push(Math.round(a * 1e6) / 1e6);
    }
    const orients = [];
    const bases = [];
    sources.forEach((source, sourceIndex) => {
      const s = source.mmPerUnit, ctr = source.center;
      const srcRegions = sourceRegions(source, holes, minArea / (s * s));
      const regions = srcRegions.map(reg => reg.map(ring => ring.map(p => ({
        x: (p.x - ctr.x) * s * (mirror.x ? -1 : 1), y: (p.y - ctr.y) * s * (mirror.y ? -1 : 1),
      }))));
      regions.forEach((reg, ri) => { reg.blocks = srcRegions[ri].blocks; });
      bases.push(regions);
      const angles = grid.slice();
      if (opts.rotate && opts.edgeAngles !== false) {
        for (const a of hullAngles(regions.map(r => r[0]), opts.edgeCount ?? 4)) {
          if (!angles.some(b => Math.abs(((a - b + 540) % 360) - 180) < 0.25)) angles.push(a);
        }
      }
      angles.sort((a, b) => a - b);
      angles.forEach(angle => {
        const rad = (angle * Math.PI) / 180, cos = Math.cos(rad), sin = Math.sin(rad);
        const rot = regions.map(reg => reg.map(ring => ring.map(p => ({ x: p.x * cos - p.y * sin, y: p.x * sin + p.y * cos }))));
        const b = boxOf(rot.flatMap(reg => reg[0]));
        orients.push({ sourceIndex, angle, regions: rot, onGrid: grid.some(g => Math.abs(g - angle) < 1e-6), minX: b.minX, minY: b.minY, maxX: b.maxX, maxY: b.maxY, w: b.maxX - b.minX, h: b.maxY - b.minY });
      });
    });
    const oneAreas = sources.map(s => Core.unionArea(s.outline) * s.mmPerUnit * s.mmPerUnit);
    const area = oneAreas.reduce((sum, v, i) => sum + v * counts[i], 0);
    return { sources, orients, counts, totalCount: counts.reduce((a, b) => a + b, 0), oneAreas, area, bases, mirror };
  }

  // ---------------------------------------------------------------- footprints
  // Vertical material runs of every x-column (even-odd inside a region, union across regions), then
  // each column grown by radius R (Minkowski sum with a disc) and merged. Conservative in both axes.
  function mergeRuns(list) {
    if (list.length <= 2) return list.slice();
    const pairs = [];
    for (let i = 0; i < list.length; i += 2) pairs.push([list[i], list[i + 1]]);
    pairs.sort((a, b) => a[0] - b[0]);
    const out = [];
    let lo = pairs[0][0], hi = pairs[0][1];
    for (let i = 1; i < pairs.length; i++) {
      if (pairs[i][0] <= hi + 1e-9) { if (pairs[i][1] > hi) hi = pairs[i][1]; } else { out.push(lo, hi); lo = pairs[i][0]; hi = pairs[i][1]; }
    }
    out.push(lo, hi);
    return out;
  }

  function footprint(orient, transposed, c, R) {
    const regions = orient.regions.map(reg => reg.map(ring => (transposed ? ring.map(p => ({ x: p.y, y: p.x })) : ring)));
    const b = boxOf(regions.flatMap(reg => reg[0]));
    const width = b.maxX - b.minX, height = b.maxY - b.minY;
    const n = Math.max(1, Math.ceil(width / c - 1e-9));
    const colEdges = regions.map(() => Array.from({ length: n }, () => []));
    regions.forEach((reg, ri) => reg.forEach(ring => {
      for (let e = 0; e < ring.length; e++) {
        const a = ring[e], d = ring[(e + 1) % ring.length];
        const ax = a.x - b.minX, ay = a.y - b.minY, dx = d.x - b.minX, dy = d.y - b.minY;
        const x0 = Math.min(ax, dx), x1 = Math.max(ax, dx);
        const i0 = Math.max(0, Math.floor(x0 / c)), i1 = Math.min(n - 1, Math.floor(x1 / c));
        for (let i = i0; i <= i1; i++) colEdges[ri][i].push(ax, ay, dx, dy);
        // A vertical edge on a column boundary belongs to the column on its left as well.
        if (Math.abs(dx - ax) < 1e-12 && i0 > 0 && Math.abs(x0 - i0 * c) < 1e-9) colEdges[ri][i0 - 1].push(ax, ay, dx, dy);
      }
    }));
    const raw = new Array(n);
    for (let i = 0; i < n; i++) {
      const xl = i * c, xr = Math.min((i + 1) * c, width);
      const all = [];
      for (let ri = 0; ri < regions.length; ri++) {
        const edges = colEdges[ri][i];
        if (!edges.length) continue;
        // The cut path itself is part of the footprint: a lead-in is a zero-width spike that the filled
        // area misses, but a pierce landing on a neighbour would ruin it, so every edge's extent in
        // this column is added to the runs.
        for (let q = 0; q < edges.length; q += 4) {
          const ax = edges[q], ay = edges[q + 1], dx = edges[q + 2], dy = edges[q + 3];
          const ex0 = Math.max(Math.min(ax, dx), xl), ex1 = Math.min(Math.max(ax, dx), xr);
          if (ex1 < ex0 - 1e-9) continue;
          if (Math.abs(dx - ax) < 1e-12) { all.push(Math.min(ay, dy), Math.max(ay, dy)); continue; }
          const sl = (dy - ay) / (dx - ax);
          const y0 = ay + (ex0 - ax) * sl, y1 = ay + (ex1 - ax) * sl;
          all.push(Math.min(y0, y1), Math.max(y0, y1));
        }
        const xs = [xl, xr];
        for (let q = 0; q < edges.length; q += 2) { const x = edges[q]; if (x > xl + 1e-9 && x < xr - 1e-9) xs.push(x); }
        xs.sort((p, q) => p - q);
        for (let j = 0; j + 1 < xs.length; j++) {
          const xa = xs[j], xb = xs[j + 1];
          if (xb - xa < 1e-9) continue;
          // No vertex lies inside (xa, xb), so the edges crossing it do not change order: sort them at the
          // midpoint, pair them even-odd, and take each run's extent from the edge values at xa and xb.
          const xm = (xa + xb) / 2;
          const cross = [];
          for (let q = 0; q < edges.length; q += 4) {
            const ax = edges[q], dx = edges[q + 2];
            if ((ax <= xm) !== (dx <= xm)) {
              const slope = (edges[q + 3] - edges[q + 1]) / (dx - ax);
              cross.push({ ym: edges[q + 1] + (xm - ax) * slope, ya: edges[q + 1] + (xa - ax) * slope, yb: edges[q + 1] + (xb - ax) * slope });
            }
          }
          if (!cross.length) continue;
          cross.sort((p, q) => p.ym - q.ym);
          if (cross.length % 2 === 0) {
            for (let t = 0; t < cross.length; t += 2) all.push(Math.min(cross[t].ya, cross[t].yb), Math.max(cross[t + 1].ya, cross[t + 1].yb));
          } else {
            let lo = Infinity, hi = -Infinity;
            for (const e of cross) { lo = Math.min(lo, e.ya, e.yb); hi = Math.max(hi, e.ya, e.yb); }
            all.push(lo, hi);
          }
        }
      }
      raw[i] = mergeRuns(all);
    }
    // Columns the part never touches (a thin neck between two lobes) take their nearest neighbour,
    // as Engine A does; a column with no runs would otherwise be treated as free.
    for (let i = 0; i < n; i++) {
      if (raw[i].length) continue;
      let j = i - 1; while (j >= 0 && !raw[j].length) j--;
      let k = i + 1; while (k < n && !raw[k].length) k++;
      const s = j >= 0 ? j : k < n ? k : -1;
      raw[i] = s >= 0 ? raw[s].slice() : [0, 0];
    }
    let top = -Infinity, bottom = Infinity;
    for (const r of raw) for (let q = 0; q < r.length; q += 2) { if (r[q + 1] > top) top = r[q + 1]; if (r[q] < bottom) bottom = r[q]; }
    const rd = R > 0 ? Math.ceil(R / c) + 1 : 0;
    const N = n + 2 * rd;
    const runs = new Array(N);
    for (let k = 0; k < N; k++) {
      const i = k - rd;
      const acc = [];
      for (let j = Math.max(0, i - rd); j <= Math.min(n - 1, i + rd); j++) {
        const dx = Math.max(0, Math.abs(i - j) - 1) * c;
        if (dx > R + 1e-12) continue;
        const v = Math.sqrt(Math.max(0, R * R - dx * dx));
        const r = raw[j];
        for (let q = 0; q < r.length; q += 2) acc.push(r[q] - v, r[q + 1] + v);
      }
      runs[k] = mergeRuns(acc);
    }
    return { n, rd, N, runs, top, bottom, width, height, bandBottom: runs.map(r => (r.length ? r[0] : 0)) };
  }

  // Collapse every column to its overall [lowest, highest].
  function hullOf(f) {
    return { ...f, runs: f.runs.map(r => (r.length > 2 ? [r[0], r[r.length - 1]] : r)) };
  }

  function chooseCell(orients, gap) {
    const maxDim = Math.max(...orients.map(o => Math.max(o.w, o.h)));
    const c = gap > 0 ? Math.min(1, Math.max(0.1, gap / 8)) : 0.25;
    return Math.max(c, maxDim / 1200);
  }

  // ---------------------------------------------------------------- lattices
  // A repeated part usually packs best in a repeating pattern. Footprints are already dilated by gap/2,
  // so two footprints that merely do not overlap are at least the gap apart.
  //
  // forbidden(): the dy for which B shifted by dx columns overlaps A, as a union of open intervals.
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
    let lo = iv[0][0], hi = iv[0][1];
    for (let i = 1; i < iv.length; i++) {
      if (iv[i][0] < hi - 1e-9) { if (iv[i][1] > hi) hi = iv[i][1]; } else { out.push([lo, hi]); lo = iv[i][0]; hi = iv[i][1]; }
    }
    out.push([lo, hi]);
    return out;
  }
  const freeAt = (m, dy) => m.every(([lo, hi]) => dy <= lo + 1e-6 || dy >= hi - 1e-6);

  // The best "row lattice" of one footprint: copies side by side in rows (touching at the smallest
  // horizontal step), each row shifted by s columns and lifted by dy over the one below. A strip is
  // filled row by row, so a lattice with a horizontal basis vector is the one that tiles it cleanly.
  // Returns { cell, step (columns), shift (columns), dy (mm) } or null.
  function bestRowLattice(F, c) {
    const cache = new Map();
    const M = dx => { let m = cache.get(dx); if (!m) { m = forbidden(F, F, dx); cache.set(dx, m); } return m; };
    let step = F.N;
    for (let dx = 1; dx < F.N; dx++) if (freeAt(M(dx), 0)) { step = dx; break; }
    let best = null;
    const reach = Math.ceil(F.N / step) + 1;
    for (let sh = 0; sh < step; sh++) {
      // the row above has copies at sh + j*step: forbid every dy where any of them overlaps the row below
      const iv = [];
      for (let j = -reach; j <= reach; j++) {
        const dx = sh + j * step;
        if (Math.abs(dx) >= F.N) continue;
        for (const q of M(dx)) iv.push(q);
      }
      iv.sort((p, q) => p[0] - q[0]);
      // lowest dy > 0 outside the union
      let dy = 1e-6;
      for (const [lo, hi] of iv) {
        if (hi <= dy + 1e-9) continue;
        if (lo >= dy - 1e-9) break;
        dy = hi;
      }
      const cell = step * c * dy;
      if (!best || cell < best.cell) best = { cell, step, shift: sh, dy };
    }
    return best;
  }

  // Footprint of a part P with a twin Q at (dx columns, dy mm), as one compound part.
  function compoundOf(fP, fQ, dx, dy) {
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

  // The densest row lattices for one source: single copies and half-turn pairs, best few by density.
  function findLattices(ctx, s, transposed, deadline) {
    const { prep, c } = ctx;
    const ks = prep.orients.map((o, k) => (o.sourceIndex === s ? k : -1)).filter(k => k >= 0);
    const area = prep.oneAreas[s];
    const found = [];
    const byAngle = new Map(ks.map(k => [Math.round(prep.orients[k].angle * 100) / 100, k]));
    for (const k of ks) {
      if (Date.now() > deadline) break;
      const F = ctx.feet(k, transposed, false);
      if (F.N > 600) continue;
      const one = bestRowLattice(F, c);
      if (one) found.push({ kind: 'single', k, perCell: 1, density: area / one.cell, ...one });
      const kq = byAngle.get(Math.round(((prep.orients[k].angle + 180) % 360) * 100) / 100);
      if (kq === undefined || kq <= k) continue;      // a pair (k, kq) is the same as (kq, k)
      const G = ctx.feet(kq, transposed, false);
      const spots = [];
      for (let dx = -(G.N - 1); dx < F.N; dx++) {
        const m = forbidden(F, G, dx);
        const ys = new Set();
        m.forEach(([lo, hi]) => { ys.add(lo); ys.add(hi); });
        for (const dy of ys) if (freeAt(m, dy)) spots.push({ dx, dy, len: Math.hypot((dx + (G.N - F.N) / 2) * c, dy) });
      }
      spots.sort((x, y) => x.len - y.len);
      for (const w of spots.slice(0, 8)) {
        const K = compoundOf(F, G, w.dx, w.dy);
        if (K.N > 900) continue;
        const two = bestRowLattice(K, c);
        if (two) found.push({ kind: 'pair', k, kq, w: { dx: w.dx, dy: w.dy }, perCell: 2, density: 2 * area / two.cell, ...two });
      }
    }
    found.sort((x, y) => y.density - x.density);
    const out = [];
    for (const f of found) {
      if (out.length >= 3) break;
      if (out.every(o => o.k !== f.k || o.kind !== f.kind)) out.push(f);
    }
    return out;
  }

  // Fill a strip of nc columns with a row lattice: rows from the bottom, each row at the lattice shift,
  // every copy whose columns fit; the last row is trimmed to n copies. phase offsets the first row.
  function tileLattice(ctx, lat, n, nc, transposed, hLimit, phase) {
    const { c } = ctx;
    const fP = ctx.feet(lat.k, transposed, false);
    const fQ = lat.kind === 'pair' ? ctx.feet(lat.kq, transposed, false) : null;
    const maxP = Math.floor((nc * c - fP.width) / c + 1e-9), maxQ = fQ ? Math.floor((nc * c - fQ.width) / c + 1e-9) : -1;
    if (maxP < 0 || (fQ && maxQ < 0)) return null;
    const items = [];
    for (let row = 0; items.length < n && row < 4000; row++) {
      const y = row * lat.dy;
      let o = (phase + row * lat.shift) % lat.step;
      if (o < 0) o += lat.step;
      // in a pair lattice a cell is P at o and Q at o + w; the cells of this row are step apart
      const cells = [];
      for (let base = o - lat.step * 2; base <= nc; base += lat.step) {
        const pi = base, qi = fQ ? base + lat.w.dx : 0;
        const pOk = pi >= 0 && pi <= maxP, qOk = !fQ || (qi >= 0 && qi <= maxQ);
        if (pOk && qOk) cells.push({ base, pi, qi });
      }
      for (const cell of cells) {
        items.push({ k: lat.k, i0: cell.pi, y });
        if (fQ) items.push({ k: lat.kq, i0: cell.qi, y: y + lat.w.dy });
        if (items.length >= n) break;
      }
      if (!cells.length && row > 0 && y > 1e6) break;
    }
    if (items.length < n) return null;
    const take = items.slice(0, n);
    const lowest = Math.min(...take.map(p => p.y));
    take.forEach(p => { p.y -= lowest; });
    const top = Math.max(...take.map(p => p.y + ctx.feet(p.k, transposed, false).top));
    if (top > hLimit + 1e-9) return null;
    return { items: take, top };
  }

  // ---------------------------------------------------------------- packer state
  const VARIANTS = [{ score: 'bl', tieTol: 3 }, { score: 'waste' }, { score: 'bl', tieTol: 1 }, { score: 'bl', tieTol: 6 }, { score: 'bl', tieTol: 2 }];

  function makePacker(ctx, o) {
    const { prep, c } = ctx;
    const W = o.W, transposed = !!o.transposed;
    let limit = o.hLimit ?? Infinity;
    const nc = Math.max(1, Math.ceil(W / c - 1e-9));
    const positions = o.positions || 160;
    const feetOf = k => ctx.feet(k, transposed, !!o.hull);
    let cols = Array.from({ length: nc }, () => []);
    const placed = [];
    const placedCounts = prep.counts.map(() => 0);
    let H = 0;
    // Memo of measure(k, i0): the lowest y depends only on the columns the footprint spans, so an entry
    // stays valid until a part is added to / removed from one of those columns (lastTouch) or the whole
    // state is replaced (epoch).
    let counter = 1, epoch = 1;
    const lastTouch = new Int32Array(nc);
    const memo = new Map();
    const touchSpan = (f, i0) => {
      counter++;
      const a = Math.max(0, i0 - f.rd), b = Math.min(nc - 1, i0 - f.rd + f.N - 1);
      for (let col = a; col <= b; col++) lastTouch[col] = counter;
    };
    const invalidateAll = () => { counter++; epoch = counter; };

    const addTo = (target, f, i0, y) => {
      const base = i0 - f.rd;
      for (let k = 0; k < f.N; k++) {
        const col = base + k;
        if (col < 0 || col >= nc) continue;
        const r = f.runs[k];
        if (!r.length) continue;
        const list = target[col];
        for (let q = 0; q < r.length; q += 2) list.push(y + r[q], y + r[q + 1]);
      }
    };
    const rebuild = skip => {
      const t = Array.from({ length: nc }, () => []);
      placed.forEach((p, i) => { if (i !== skip) addTo(t, feetOf(p.k), p.i0, p.y); });
      return t;
    };
    function lowest(f, i0) {
      const { runs, N, rd } = f;
      const base = i0 - rd;
      let y = 0;
      for (let pass = 0; pass < 1000; pass++) {
        let moved = false;
        for (let k = 0; k < N; k++) {
          const col = base + k;
          if (col < 0 || col >= nc) continue;
          const r = runs[k], list = cols[col];
          if (!r.length || !list.length) continue;
          for (let a = 0; a < r.length; a += 2) {
            const lo = r[a], hi = r[a + 1];
            for (let q = 0; q < list.length; q += 2) {
              if (y + lo < list[q + 1] - 1e-9 && y + hi > list[q] + 1e-9) { y = list[q + 1] - lo; moved = true; }
            }
          }
        }
        if (!moved) break;
      }
      return y;
    }
    function waste(r) {
      const f = r.f;
      const base = r.i0 - f.rd;
      let sum = 0;
      for (let k = 0; k < f.N; k++) {
        const col = base + k;
        if (col < 0 || col >= nc) continue;
        const rr = f.runs[k];
        if (!rr.length) continue;
        const bottom = r.y + rr[0];
        let nearest = -ctx.R;
        const list = cols[col];
        for (let q = 1; q < list.length; q += 2) if (list[q] <= bottom + 1e-9 && list[q] > nearest) nearest = list[q];
        sum += bottom - nearest;
      }
      r.waste = sum * c;
    }
    function measure(f, i0, k) {
      let m = memo.get(k);
      if (!m) { m = { y: new Float64Array(nc + 1), at: new Int32Array(nc + 1) }; memo.set(k, m); }
      let y;
      let valid = m.at[i0] >= epoch && m.at[i0] > 0;
      if (valid) {
        const a = Math.max(0, i0 - f.rd), b = Math.min(nc - 1, i0 - f.rd + f.N - 1);
        const at = m.at[i0];
        for (let col = a; col <= b; col++) if (lastTouch[col] > at) { valid = false; break; }
      }
      if (valid) y = m.y[i0];
      else { y = lowest(f, i0); m.y[i0] = y; m.at[i0] = counter; }
      const ytop = y + f.top;
      if (ytop > limit + 1e-9) return null;
      return { i0, y, ytop, cost1: Math.max(H, ytop), waste: -1, f };
    }
    const better = (a, b, v) => {
      if (!b) return true;
      const tol = (v.tieTol ?? 3) * c;
      if (a.waste < 0) waste(a);
      if (b.waste < 0) waste(b);
      if (v.score === 'waste') {
        if (Math.abs(a.cost1 - b.cost1) > 1e-6) return a.cost1 < b.cost1;
        if (Math.abs(a.waste - b.waste) > 1e-6) return a.waste < b.waste;
        if (Math.abs(a.y - b.y) > 1e-6) return a.y < b.y;
        return a.i0 < b.i0;
      }
      if (Math.abs(a.cost1 - b.cost1) > tol) return a.cost1 < b.cost1;
      if (Math.abs(a.y - b.y) > tol) return a.y < b.y;
      if (a.i0 !== b.i0) return a.i0 < b.i0;
      return a.waste < b.waste;
    };

    // Best position of orientation k, or null. `best` lets a worse cost be dropped early.
    function bestPosition(k, best, v) {
      const f = feetOf(k);
      const maxI0 = Math.floor((W - f.width) / c + 1e-9);
      if (maxI0 < 0) return null;
      // cost1 is at least the orientation's own height, so a tall orientation cannot beat the best so far.
      if (best && Math.max(H, f.top) > best.cost1 + 1e-6) return null;
      const stride = Math.max(1, Math.ceil((maxI0 + 1) / positions));
      const coarse = [];
      const tryAt = i0 => {
        const r = measure(f, i0, k);
        if (!r) return null;
        if (best && r.cost1 > best.cost1 + 1e-6) return null;
        r.k = k;
        return r;
      };
      for (let i0 = 0; ; i0 += stride) {
        if (i0 > maxI0) i0 = maxI0;
        const r = tryAt(i0);
        if (r) coarse.push(r);
        if (i0 >= maxI0) break;
      }
      if (!coarse.length) return null;
      coarse.sort((a, b2) => (better(a, b2, v) ? -1 : 1));
      let local = coarse[0];
      if (stride > 1) {
        for (const seed of coarse.slice(0, 3)) {
          for (let i0 = Math.max(0, seed.i0 - stride + 1); i0 <= Math.min(maxI0, seed.i0 + stride - 1); i0++) {
            const r = tryAt(i0);
            if (r && better(r, local, v)) local = r;
          }
        }
      }
      return local;
    }

    const api = {
      c, W, transposed, placed, placedCounts,
      get H() { return H; },
      setLimit(v) { limit = v; },
      feet: feetOf,
      remaining: s => prep.counts[s] - placedCounts[s],
      bestPosition, better,
      commit(r) {
        const f = r.f;
        addTo(cols, f, r.i0, r.y);
        touchSpan(f, r.i0);
        if (r.ytop > H) H = r.ytop;
        const s = prep.orients[r.k].sourceIndex;
        placed.push({ k: r.k, sourceIndex: s, i0: r.i0, y: r.y });
        placedCounts[s]++;
      },
      reset() { placed.length = 0; placedCounts.fill(0); cols = rebuild(-1); H = 0; invalidateAll(); },
      load(items) {
        placed.length = 0; placedCounts.fill(0);
        for (const it of items) { placed.push({ ...it }); placedCounts[it.sourceIndex]++; }
        cols = rebuild(-1);
        api.recalc();
        invalidateAll();
      },
      removeAt(indices) {
        const drop = new Set(indices);
        const kept = placed.filter((_, i) => !drop.has(i));
        const gone = placed.filter((_, i) => drop.has(i));
        placed.length = 0; placed.push(...kept);
        gone.forEach(p => { placedCounts[p.sourceIndex]--; touchSpan(feetOf(p.k), p.i0); });
        cols = rebuild(-1);
        api.recalc();
        return gone;
      },
      addItems(items) {
        for (const it of items) {
          const f = feetOf(it.k);
          addTo(cols, f, it.i0, it.y);
          touchSpan(f, it.i0);
          placed.push({ k: it.k, sourceIndex: it.sourceIndex, i0: it.i0, y: it.y });
          placedCounts[it.sourceIndex]++;
        }
        api.recalc();
      },
      recalc() { H = placed.reduce((m, p) => Math.max(m, p.y + feetOf(p.k).top), 0); },
      snapshot() { return placed.map(p => ({ ...p })); },
      stats() {
        let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
        for (const p of placed) {
          const f = feetOf(p.k);
          minX = Math.min(minX, p.i0 * c); maxX = Math.max(maxX, p.i0 * c + f.width);
          minY = Math.min(minY, p.y); maxY = Math.max(maxY, p.y + f.top);
        }
        return { count: placed.length, H: placed.length ? maxY - minY : 0, usedW: placed.length ? maxX - minX : 0 };
      },
      // Let each part fall further toward the origin corner (as Engine A's compaction pass).
      * compact(ctl) {
        if (placed.length < 2 || placed.length > 400) return;
        for (let round = 0; round < 8; round++) {
          let moved = false;
          const order = placed.map((_, i) => i).sort((a, b) => placed[a].y - placed[b].y || placed[a].i0 - placed[b].i0);
          for (const idx of order) {
            const p = placed[idx], f = feetOf(p.k);
            cols = rebuild(idx);
            let bi = p.i0, by = Math.min(p.y, lowest(f, p.i0));
            for (let again = 0; again < 3; again++) {
              const before = bi * 1e6 + by;
              for (let i = bi - 1; i >= 0; i--) {
                const y1 = lowest(f, i);
                if (y1 <= by + 1e-6) { bi = i; by = Math.min(by, y1); } else break;
              }
              by = Math.min(by, lowest(f, bi));
              if (bi * 1e6 + by === before) break;
            }
            if (bi !== p.i0 || by < p.y - 1e-6) { p.i0 = bi; p.y = by; moved = true; }
            cols = rebuild(-1);
          }
          yield { placed: placed.length };
          if (ctl && ctl.cancelled) throw Error('Nesting stopped.');
          if (!moved) break;
        }
        api.recalc();
        invalidateAll();
      },
    };
    return api;
  }

  // ---------------------------------------------------------------- search
  function* greedy(pk, ctx, variant, allowed, ctl) {
    let last = Date.now();
    for (;;) {
      let best = null;
      for (const k of allowed) {
        if (pk.remaining(ctx.prep.orients[k].sourceIndex) <= 0) continue;
        const r = pk.bestPosition(k, best, variant);
        if (r && pk.better(r, best, variant)) best = r;
        if (Date.now() - last > 40) {
          last = Date.now();
          yield { placed: pk.placed.length };
          if (ctl && ctl.cancelled) throw Error('Nesting stopped.');
        }
      }
      if (!best) return;
      pk.commit(best);
      yield { placed: pk.placed.length };
      if (ctl && ctl.cancelled) throw Error('Nesting stopped.');
    }
  }

  // Places parts one at a time in the given order of source indexes, each at its best orientation and
  // position. Much cheaper than the best-fit greedy (no search across part types), so it is used to
  // produce differently-shaped starting points for the improvement loop.
  function* sequential(pk, ctx, order, variant, ctl) {
    let last = Date.now();
    for (const s of order) {
      let best = null;
      for (const k of ctx.allowedFor(s)) {
        const r = pk.bestPosition(k, best, variant);
        if (r && pk.better(r, best, variant)) best = r;
      }
      if (!best) return false;
      pk.commit(best);
      if (Date.now() - last > 40) {
        last = Date.now();
        yield { placed: pk.placed.length };
        if (ctl && ctl.cancelled) throw Error('Nesting stopped.');
      }
    }
    return true;
  }

  // For a sheet that cannot take every copy yet: take out one to three placed parts, then try to put
  // them and the missing copies back in a random largest-first order; keep it when more copies fit.
  function* fillLeftovers(pk, ctx, items, deadline, rand, ctl, stall = 120) {
    const prep = ctx.prep, total = prep.totalCount;
    pk.load(items);
    let bestItems = pk.snapshot(), bestCount = bestItems.length;
    let fails = 0, attempts = 0, accepted = 0, dirty = null, last = Date.now();
    while (Date.now() < deadline && bestCount < total && fails < stall && bestItems.length) {
      attempts++;
      if (dirty) {
        pk.removeAt(Array.from({ length: dirty.inserted }, (_, i) => pk.placed.length - 1 - i));
        pk.addItems(dirty.gone);
        dirty = null;
      }
      const picks = new Set();
      const n = Math.min(pk.placed.length, 1 + Math.floor(rand() * 3));
      while (picks.size < n) picks.add(Math.floor(rand() * pk.placed.length));
      const gone = pk.removeAt([...picks]);
      const want = [];
      prep.counts.forEach((_, s) => { for (let q = pk.remaining(s); q > 0; q--) want.push(s); });
      want.sort((x, y) => prep.oneAreas[y] * (0.6 + 0.8 * rand()) - prep.oneAreas[x] * (0.6 + 0.8 * rand()));
      const variant = VARIANTS[Math.floor(rand() * 2)];
      let inserted = 0;
      for (const s of want) {
        let best = null;
        for (const k of ctx.allowedFor(s)) {
          const r = pk.bestPosition(k, best, variant);
          if (r && pk.better(r, best, variant)) best = r;
        }
        if (!best) continue;
        pk.commit(best);
        inserted++;
      }
      if (pk.placed.length > bestCount) { bestItems = pk.snapshot(); bestCount = bestItems.length; accepted++; fails = 0; } else { fails++; dirty = { inserted, gone }; }
      if (Date.now() - last > 40) {
        last = Date.now();
        yield { placed: bestCount };
        if (ctl && ctl.cancelled) throw Error('Nesting stopped.');
      }
    }
    return { items: bestItems, attempts, accepted };
  }

  // Strip-shrinking improvement. Lower the length limit a little, take out the parts that no longer
  // fit under it plus a few neighbours, and re-insert them; keep the result if every part found a place.
  function* shrink(pk, ctx, items, deadline, rand, ctl, areaWeight, stall = 60) {
    const prep = ctx.prep;
    const score = s => (areaWeight ? s.usedW * s.H : s.H);
    pk.load(items);
    let bestItems = pk.snapshot(), bestStats = pk.stats();
    let fails = 0, attempts = 0, accepted = 0;
    const allowedBy = prep.counts.map((_, s) => ctx.allowedFor(s));
    let last = Date.now();
    let dirty = null;     // the removed parts of a failed attempt, to put back
    while (Date.now() < deadline && bestItems.length > 1) {
      attempts++;
      if (dirty) {
        // Undo the previous attempt: take out whatever it inserted (always the last entries), put back what it removed.
        pk.removeAt(Array.from({ length: dirty.inserted }, (_, i) => pk.placed.length - 1 - i));
        pk.addItems(dirty.gone);
        dirty = null;
      }
      const H = bestStats.H;
      const delta = Math.max(pk.c * 2, H * (fails > 30 ? 0.001 : fails > 12 ? 0.0025 : 0.005));
      const lim = H - delta;
      pk.setLimit(lim);
      const out = [];
      pk.placed.forEach((p, i) => { if (p.y + pk.feet(p.k).top > lim + 1e-9) out.push(i); });
      // Neighbours: parts closest to the top edge (the ones the displaced parts must squeeze among).
      const rest = pk.placed.map((p, i) => ({ i, top: p.y + pk.feet(p.k).top })).filter(e => !out.includes(e.i)).sort((a, b) => b.top - a.top);
      const extra = Math.min(rest.length, 1 + Math.floor(rand() * (2 + Math.min(10, fails / 2))));
      for (let e = 0; e < extra; e++) {
        const pickIdx = Math.min(rest.length - 1, Math.floor(rand() * rand() * rest.length * 0.6 + e * 0.3));
        const cand = rest[pickIdx];
        if (cand && !out.includes(cand.i)) out.push(cand.i);
      }
      const gone = pk.removeAt(out);
      // Re-insert largest first with some noise, so different attempts try different orders.
      const area = p => prep.oneAreas[p.sourceIndex];
      gone.sort((a, b) => area(b) * (0.7 + 0.6 * rand()) - area(a) * (0.7 + 0.6 * rand()));
      const variant = VARIANTS[Math.floor(rand() * 2)];
      let ok = true, inserted = 0;
      for (const g of gone) {
        let best = null;
        for (const k of allowedBy[g.sourceIndex]) {
          const r = pk.bestPosition(k, best, variant);
          if (r && pk.better(r, best, variant)) best = r;
        }
        if (!best) { ok = false; break; }
        pk.commit(best);
        inserted++;
      }
      let keep = false;
      if (ok) {
        const st = pk.stats();
        if (score(st) < score(bestStats) - 1e-6) { bestItems = pk.snapshot(); bestStats = st; fails = 0; accepted++; keep = true; } else fails++;
      } else fails++;
      if (!keep) dirty = { inserted, gone };
      if (Date.now() - last > 40) {
        last = Date.now();
        yield { placed: bestItems.length };
        if (ctl && ctl.cancelled) throw Error('Nesting stopped.');
      }
      if (fails > stall) break;
    }
    pk.setLimit(Infinity);
    return { items: bestItems, stats: bestStats, attempts, accepted };
  }

  // ---------------------------------------------------------------- results
  function describe(pk) {
    const st = pk.stats();
    return { items: pk.snapshot(), count: st.count, H: st.H, usedW: st.usedW, W: pk.W, c: pk.c, transposed: pk.transposed };
  }

  // Frame-size bookkeeping in the solver frame -> layout placements (true X/Y), centre positions.
  function toLayout(prep, r) {
    return r.items.map(p => {
      const or = prep.orients[p.k];
      const bx = r.transposed ? p.y : p.i0 * r.c;
      const by = r.transposed ? p.i0 * r.c : p.y;
      return { k: p.k, sourceIndex: or.sourceIndex, angle: or.angle, cx: bx - or.minX, cy: by - or.minY };
    });
  }
  function tighten(prep, placements) {
    const b = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
    for (const p of placements) {
      const or = prep.orients[p.k];
      b.minX = Math.min(b.minX, p.cx + or.minX); b.maxX = Math.max(b.maxX, p.cx + or.maxX);
      b.minY = Math.min(b.minY, p.cy + or.minY); b.maxY = Math.max(b.maxY, p.cy + or.maxY);
    }
    return {
      placements: placements.map(p => ({ ...p, cx: p.cx - b.minX, cy: p.cy - b.minY })),
      frame: { w: b.maxX - b.minX, h: b.maxY - b.minY },
    };
  }
  // Solved with mirrored shapes: reflecting the finished layout gives the real parts packed against the
  // requested corner. A reflection conjugates a rotation to its inverse; two reflections (a half turn)
  // leave rotations unchanged.
  function mapBack(placements, frame, mirror) {
    return placements.map(p => ({
      sourceIndex: p.sourceIndex, k: p.k,
      angle: mirror.x && mirror.y ? normAngle(p.angle) : mirror.x || mirror.y ? normAngle(-p.angle) : p.angle,
      cx: mirror.x ? frame.w - p.cx : p.cx,
      cy: mirror.y ? frame.h - p.cy : p.cy,
    }));
  }

  // ---------------------------------------------------------------- exact verification
  function segDist(a, b, c, d) {
    const o = (p, q, r) => (q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x);
    const o1 = o(a, b, c), o2 = o(a, b, d), o3 = o(c, d, a), o4 = o(c, d, b);
    if (((o1 > 0 && o2 < 0) || (o1 < 0 && o2 > 0)) && ((o3 > 0 && o4 < 0) || (o3 < 0 && o4 > 0))) return 0;
    const ps = (p, s, t) => {
      const dx = t.x - s.x, dy = t.y - s.y, l = dx * dx + dy * dy;
      const u = l ? Math.max(0, Math.min(1, ((p.x - s.x) * dx + (p.y - s.y) * dy) / l)) : 0;
      return Math.hypot(p.x - s.x - u * dx, p.y - s.y - u * dy);
    };
    return Math.min(ps(a, c, d), ps(b, c, d), ps(c, a, b), ps(d, a, b));
  }
  function ringsDistance(A, B, reach) {
    let best = Infinity;
    for (const pa of A) for (const pb of B) {
      for (let i = 0; i < pa.length; i++) {
        const a1 = pa[i], a2 = pa[(i + 1) % pa.length];
        const ax0 = Math.min(a1.x, a2.x), ax1 = Math.max(a1.x, a2.x), ay0 = Math.min(a1.y, a2.y), ay1 = Math.max(a1.y, a2.y);
        const lim = Math.min(best, reach);
        for (let j = 0; j < pb.length; j++) {
          const b1 = pb[j], b2 = pb[(j + 1) % pb.length];
          if (Math.min(b1.x, b2.x) - lim > ax1 || Math.max(b1.x, b2.x) + lim < ax0 || Math.min(b1.y, b2.y) - lim > ay1 || Math.max(b1.y, b2.y) + lim < ay0) continue;
          const d = segDist(a1, a2, b1, b2);
          if (d < best) { best = d; if (best === 0) return 0; }
        }
      }
    }
    return best;
  }
  const inMaterial = (regions, pt) => regions.some(reg => reg.reduce((n, ring) => n + (pointInPoly(pt, ring) ? 1 : 0), 0) % 2 === 1);

  // Real parts (no mirroring) at their final placement, then pairwise exact distance and a material
  // containment test (a part swallowed by another's material crosses no boundary but still overlaps).
  function verify(prep, placements, gap, frame) {
    const shapes = placements.map(p => {
      const rad = (p.angle * Math.PI) / 180, cos = Math.cos(rad), sin = Math.sin(rad);
      const base = prep.realBases[p.sourceIndex];
      const regions = base.map(reg => reg.map(ring => ring.map(q => ({ x: q.x * cos - q.y * sin + p.cx, y: q.x * sin + q.y * cos + p.cy }))));
      return { regions, rings: regions.flat(), box: boxOf(regions.flatMap(r => r[0])) };
    });
    let minGap = Infinity, outside = 0, swallowed = 0;
    const reach = gap + 2;
    shapes.forEach(s => {
      const b = s.box;
      if (b.minX < -1e-6 || b.minY < -1e-6 || b.maxX > frame.w + 1e-6 || b.maxY > frame.h + 1e-6) outside++;
    });
    for (let i = 0; i < shapes.length; i++) {
      for (let j = i + 1; j < shapes.length; j++) {
        const a = shapes[i].box, b = shapes[j].box;
        if (a.minX - b.maxX > reach || b.minX - a.maxX > reach || a.minY - b.maxY > reach || b.minY - a.maxY > reach) continue;
        let d = ringsDistance(shapes[i].rings, shapes[j].rings, reach);
        if (d > 0) {
          const hit = shapes[j].regions.some(r => inMaterial(shapes[i].regions, r[0][0])) || shapes[i].regions.some(r => inMaterial(shapes[j].regions, r[0][0]));
          if (hit) { d = 0; swallowed++; }
        }
        if (d < minGap) minGap = d;
      }
    }
    return { minGap, outside, swallowed, ok: outside === 0 && swallowed === 0 && minGap >= gap - 1e-6 };
  }

  // Parts that sit inside another part's hole: [{ host, block, inner }] with placement indexes and the
  // host's cut block that makes that hole.
  function findNested(prep, placements) {
    const shapes = placements.map(p => {
      const rad = (p.angle * Math.PI) / 180, cos = Math.cos(rad), sin = Math.sin(rad);
      const regions = prep.realBases[p.sourceIndex].map(reg => {
        const out = reg.map(ring => ring.map(q => ({ x: q.x * cos - q.y * sin + p.cx, y: q.x * sin + q.y * cos + p.cy })));
        out.blocks = reg.blocks;
        return out;
      });
      return { regions, box: boxOf(regions.flatMap(r => r[0])) };
    });
    const found = [];
    for (let i = 0; i < shapes.length; i++) {
      for (let j = 0; j < shapes.length; j++) {
        if (i === j) continue;
        const a = shapes[i].box, b = shapes[j].box;
        if (b.minX < a.minX || b.maxX > a.maxX || b.minY < a.minY || b.maxY > a.maxY) continue;
        const probe = shapes[j].regions[0][0][0];
        outer: for (const reg of shapes[i].regions) {
          for (let r = 1; r < reg.length; r++) {
            if (pointInPoly(probe, reg[r]) && ringDepthEven(reg, r) === false) { found.push({ host: i, block: reg.blocks[r], inner: j }); break outer; }
          }
        }
      }
    }
    return found;
  }

  // Cut-order adjustment for parts in holes: the part inside a hole is cut completely before the hole
  // itself, so the slug is still held by the sheet while the part is cut from it; the host's own outline
  // follows its hole.
  function makeReorder(nested) {
    if (!nested.length) return null;
    return seq => {
      const items = seq.slice();
      const where = (part, block) => items.findIndex(it => it.part.index === part && it.block === block);
      for (let pass = 0; pass < 8; pass++) {
        let moved = false;
        for (const n of nested) {
          const h = where(n.host, n.block);
          if (h < 0) continue;
          // everything cut for the inner part (and for parts nested in it, transitively)
          const deps = new Set([n.inner]);
          for (let grow = true; grow;) { grow = false; for (const m of nested) if (deps.has(m.host) && !deps.has(m.inner)) { deps.add(m.inner); grow = true; } }
          let last = -1;
          items.forEach((it, idx) => { if (deps.has(it.part.index)) last = Math.max(last, idx); });
          if (last > h) {
            const [hole] = items.splice(h, 1);
            items.splice(last, 0, hole);   // after removal, index `last` is just past the dependent cuts
            moved = true;
          }
          const at = where(n.host, n.block);
          // the host's outer cuts come after its hole
          for (let idx = 0; idx < at; idx++) {
            const it = items[idx];
            if (it.part.index === n.host && !it.internal) { items.splice(idx, 1); items.splice(where(n.host, n.block) + 1, 0, it); moved = true; break; }
          }
        }
        if (!moved) break;
      }
      return items;
    };
  }

  // Ring i of a region is material (an island) when an even number of the larger rings contain it.
  function ringDepthEven(reg, i) {
    let depth = 0;
    for (let j = 0; j < i; j++) if (pointInPoly(reg[i][0], reg[j])) depth++;
    return depth % 2 === 0;
  }

  // ---------------------------------------------------------------- driver
  const BUDGETS = { quick: 12000, medium: 45000, long: 100000 };

  function* nestGen(src, opts, ctl) {
    const sources = Array.isArray(src) ? src : [src];
    if (!sources.length || sources.some(s => !s)) throw Error('Add at least one G-code file.');
    const gap = Number(opts.gap);
    if (!(gap >= 0)) throw Error('Minimum gap must be 0 or more.');
    const counts = Array.isArray(opts.counts) ? opts.counts.map(v => Math.floor(Number(v))) : [Math.floor(Number(opts.count))];
    if (counts.length !== sources.length || counts.some(v => !(v >= 1 && v <= 2000))) throw Error('Each file must have between 1 and 2000 copies.');
    const totalCount = counts.reduce((a, b) => a + b, 0);
    if (totalCount > 2000) throw Error('The total requested copies must not exceed 2000.');
    const prefer = opts.prefer === 'length' ? 'length' : 'compact';
    const origin = opts.origin || 'bottom-left';
    const mirror = { x: prefer === 'compact' && origin.endsWith('right'), y: prefer === 'compact' && origin.startsWith('top') };
    const started = Date.now();
    const budget = Number(opts.budgetMs) > 0 ? Number(opts.budgetMs) : BUDGETS[opts.budget] || BUDGETS.quick;
    const deadline = started + budget;
    const rand = rng(opts.seed ?? 12345);
    const patience = Number(opts.patience) > 0 ? Number(opts.patience) : ({ quick: 3, medium: 8, long: 16 }[opts.budget] || 3);

    const prep = prepare(sources, { ...opts, counts, mirror });
    if (!(prep.area > 0)) throw Error('A file outline has no area to pack.');
    prep.realBases = prepare(sources, { ...opts, counts, mirror: { x: false, y: false }, rotate: false }).bases;
    const c = chooseCell(prep.orients, gap);
    const R = gap > 0 ? gap / 2 + FLAT_TOL : 0;
    const feetCache = new Map();
    const latticeCache = new Map();
    const ctx = {
      prep, c, R,
      // hull = Engine A's model: one [lowest, highest] per column, so a part never enters another's notch.
      // Its layouts are valid in the finer model too, so they are kept as starting points.
      feet(k, transposed, hull) {
        const key = k * 4 + (transposed ? 1 : 0) + (hull ? 2 : 0);
        let f = feetCache.get(key);
        if (!f) {
          f = hull ? hullOf(ctx.feet(k, transposed, false)) : footprint(prep.orients[k], transposed, c, R);
          feetCache.set(key, f);
        }
        return f;
      },
      lattices(s, transposed) {
        const key = s * 2 + (transposed ? 1 : 0);
        if (!latticeCache.has(key)) latticeCache.set(key, findLattices(ctx, s, transposed, Date.now() + Math.max(1500, budget * 0.15)));
        return latticeCache.get(key);
      },
      allKs: prep.orients.map((_, k) => k),
      allowedFor: s => prep.orients.map((o, k) => (o.sourceIndex === s ? k : -1)).filter(k => k >= 0),
    };
    const gridKs = prep.orients.map((o, k) => (o.onGrid ? k : -1)).filter(k => k >= 0);
    const quarterKs = prep.orients.map((o, k) => (Math.abs(o.angle % 90) < 1e-9 ? k : -1)).filter(k => k >= 0);
    const zeroKs = prep.orients.map((o, k) => (Math.abs(o.angle) < 1e-9 ? k : -1)).filter(k => k >= 0);
    const need = (v, label) => { if (!(v > 0)) throw Error(label + ' must be greater than 0.'); return v; };
    const fits = (dim, transposed) => prep.orients.some(o => (transposed ? o.h : o.w) <= dim + 1e-9);
    const search = { constructions: 0, attempts: 0, accepted: 0 };
    const mode = opts.mode;
    const areaMode = mode === 'minArea';
    const score = r => (areaMode ? r.usedW * r.H : r.H);

    // Pick like Engine A: most parts, then (compact) the smallest frame area among results within 3% of
    // the shortest length, or (length / minimum-area modes) strictly the best score.
    function choose(pool) {
      const most = Math.max(...pool.map(r => r.count));
      let cand = pool.filter(r => r.count === most);
      if (!areaMode && prefer === 'compact') {
        const shortest = Math.min(...cand.map(r => r.H));
        cand = cand.filter(r => r.H <= shortest * 1.03 + 1e-9);
        return cand.sort((a, b) => a.usedW * a.H - b.usedW * b.H || a.H - b.H)[0];
      }
      return cand.sort((a, b) => score(a) - score(b) || a.usedW - b.usedW)[0];
    }

    // One strip of width W: several constructions, then improvement starts until `until`.
    function* solveStrip(W, so) {
      const popts = { W, transposed: !!so.transposed, hLimit: so.hLimit, positions: so.positions };
      const pk = makePacker(ctx, popts);                       // notch-aware footprints (holes, concavities)
      const pkH = makePacker(ctx, { ...popts, hull: true });   // Engine A's footprints
      const pool = [];
      // The full set (step grid plus edge-aligned angles), then the plain step grid on its own and the
      // quarter turns alone: a larger orientation set must never lose to a smaller one by luck.
      const smaller = set => set.length > 1 && set.length < ctx.allKs.length;
      const sets = so.light ? [ctx.allKs, ...(smaller(gridKs) ? [gridKs] : []), ...(smaller(quarterKs) && quarterKs.length < gridKs.length ? [quarterKs] : [])] : [ctx.allKs, ...(smaller(gridKs) ? [gridKs] : []), ...(smaller(quarterKs) && quarterKs.length < gridKs.length ? [quarterKs] : [])];
      const n = so.variantCount ?? (opts.effort >= 1 ? Math.min(VARIANTS.length, Math.floor(opts.effort)) : 3);
      const variants = so.light ? [VARIANTS[0]] : VARIANTS.slice(0, n);
      // Both models: the coarse one reproduces Engine A's arrangements, the fine one can do more but
      // its greedy choices differ, so neither is allowed to lose to the other by luck.
      for (const model of [pkH, pk]) {
        for (const set of sets) {
          for (const v of (set === ctx.allKs ? variants : VARIANTS.slice(0, so.variantCount ?? VARIANTS.length))) {
            model.reset();
            yield* greedy(model, ctx, v, set, ctl);
            if (model.placed.length) yield* model.compact(ctl);
            search.constructions++;
            pool.push(describe(model));
            if (Date.now() > so.until && !so.light) break;
          }
        }
      }
      // Lattice seeds: the source with the most material, when it has enough copies for a pattern to pay.
      const dominant = prep.counts.map((n, s) => ({ s, n, m: n * prep.oneAreas[s] })).sort((a, b) => b.m - a.m)[0];
      if (opts.lattice !== false && dominant && dominant.n >= 6) {
        const nc = Math.max(1, Math.ceil(W / ctx.c - 1e-9));
        const lim = so.hLimit ?? Infinity;
        for (const lat of ctx.lattices(dominant.s, !!so.transposed).slice(0, so.light ? 1 : 3)) {
          if (!so.light && Date.now() > so.until) break;
          const cands = [];
          // Fewer copies in the pattern leave the ragged edges to the greedy fill, which uses them.
          const phases = so.light ? [0] : [0, Math.round(lat.step / 2)];
          const fractions = so.light ? [1, 0.6] : [1, 0.8, 0.6, 0.4];
          for (const ph of phases) for (const fr of fractions) {
            const t = tileLattice(ctx, lat, Math.max(2, Math.round(dominant.n * fr)), nc, !!so.transposed, lim, ph);
            if (t) cands.push(t);
          }
          // all of them go through the greedy fill: a pattern with fewer copies is not shorter, but may fill better
          for (const t of cands.slice(0, so.light ? 2 : 6)) {
            if (!so.light && Date.now() > so.until) break;
            pk.load(t.items.map(it => ({ k: it.k, sourceIndex: dominant.s, i0: it.i0, y: it.y })));
            yield* greedy(pk, ctx, VARIANTS[0], ctx.allKs, ctl);
            if (pk.placed.length) yield* pk.compact(ctl);
            search.constructions++;
            search.lattice = true;
            pool.push(describe(pk));
          }
        }
      }
      if (!so.light) {
        // Largest first: the best-fit greedy above tends to place the small parts first (they grow the
        // frame least), which leaves no holes to use and no big notch for them to fill.
        const bigFirst = prep.counts.flatMap((n, s) => Array(n).fill(s)).sort((x, y) => prep.oneAreas[y] - prep.oneAreas[x]);
        for (const v of [VARIANTS[0], VARIANTS[1]]) {
          pk.reset();
          const ok = yield* sequential(pk, ctx, bigFirst, v, ctl);
          search.constructions++;
          if (ok) { yield* pk.compact(ctl); pool.push(describe(pk)); }
        }
        const complete = pool.filter(r => r.count === prep.totalCount).sort((a, b) => score(a) - score(b));
        if (!complete.length && Number.isFinite(so.hLimit) && Date.now() < so.until) {
          // Not everything fits yet: use the time to fit more copies instead of shrinking.
          const top = pool.slice().sort((a, b) => b.count - a.count || score(a) - score(b))[0];
          const res = yield* fillLeftovers(pk, ctx, top.items, so.until, rand, ctl);
          search.attempts += res.attempts; search.accepted += res.accepted;
          pk.load(res.items);
          pool.push(describe(pk));
        }
        // A sheet is the frame: once every copy fits there is nothing left to shrink.
        if (mode === 'maxParts' && complete.length) complete.length = 0;
        let start = 0, idle = 0;
        let bestScore = Math.min(...pool.map(r => score(r)));
        const typeOrder = prep.counts.flatMap((n, s) => Array(n).fill(s));
        while (complete.length && Date.now() < so.until && idle < patience) {
          let items;
          if (start < Math.min(3, complete.length)) items = complete[start].items;
          else {
            // A fresh start: parts in decreasing area with noise, then a plain bottom-left sequence.
            const order = typeOrder.slice().sort((x, y) => prep.oneAreas[y] * (0.6 + 0.8 * rand()) - prep.oneAreas[x] * (0.6 + 0.8 * rand()));
            pk.reset();
            const ok = yield* sequential(pk, ctx, order, VARIANTS[Math.floor(rand() * 2)], ctl);
            search.constructions++;
            start++;
            if (!ok) continue;
            items = pk.snapshot();
          }
          if (start < 3) start++;
          const res = yield* shrink(pk, ctx, items, so.until, rand, ctl, areaMode);
          search.attempts += res.attempts; search.accepted += res.accepted;
          pk.load(res.items);
          yield* pk.compact(ctl);
          const got = describe(pk);
          pool.push(got);
          // Stop early once several fresh starts in a row bring nothing: more time would not help.
          if (score(got) < bestScore - 1e-6) { bestScore = score(got); idle = 0; } else idle++;
        }
      }
      return choose(pool);
    }

    let placements, frame, fixedFrame = null;
    if (mode === 'fixedX' || mode === 'fixedY') {
      const transposed = mode === 'fixedY';
      const W = need(Number(transposed ? opts.sizeY : opts.sizeX), transposed ? 'Maximum Y' : 'Maximum X');
      if (!fits(W, transposed)) throw Error(`A file is ${transposed ? 'taller than the maximum Y' : 'wider than the maximum X'} in every allowed orientation.`);
      const r = yield* solveStrip(W, { transposed, until: deadline });
      ({ placements, frame } = tighten(prep, toLayout(prep, r)));
    } else if (mode === 'maxParts') {
      const sw = need(Number(opts.sizeX), 'Sheet X'), sh = need(Number(opts.sizeY), 'Sheet Y');
      if (!fits(sw, false) && !fits(sh, true)) throw Error('At least one requested file does not fit on that sheet in any allowed orientation.');
      const results = [];
      const half = started + budget / 2;
      if (fits(sw, false)) results.push(yield* solveStrip(sw, { hLimit: sh, until: fits(sh, true) ? half : deadline }));
      if (fits(sh, true)) results.push(yield* solveStrip(sh, { hLimit: sw, transposed: true, until: deadline }));
      const pick = results.sort((a, b) => b.count - a.count || score(a) - score(b))[0];
      if (!pick || !pick.count) throw Error('None of the requested files fit on that sheet.');
      placements = toLayout(prep, pick);
      fixedFrame = { w: sw, h: sh };
      frame = fixedFrame;
    } else if (mode === 'minArea') {
      const limX = Number(opts.sizeX) > 0 ? Number(opts.sizeX) : Infinity;
      const limY = Number(opts.sizeY) > 0 ? Number(opts.sizeY) : Infinity;
      const widths = prep.orients.map(o => o.w);
      const wLo = Math.min(...widths), wMax = Math.max(...widths);
      if (wLo > limX + 1e-9) throw Error('A file is wider than the X limit in every allowed orientation.');
      const wHi = Math.min(limX, Math.max(wLo, totalCount * (wMax + gap)));
      const meanArea = prep.area / Math.max(1, totalCount);
      const guess = Math.min(wHi, Math.max(wLo, Math.sqrt(totalCount * meanArea * 1.3)));
      const cand = new Set([guess]);
      for (let k = 0; k <= 12; k++) cand.add(wLo * Math.pow(Math.max(wHi, wLo * 1.0001) / wLo, k / 12));
      // The narrowest strips are decided by individual orientation widths (a part standing on its end in
      // a column); try each distinct one, not just a geometric ladder that can step over it.
      [...new Set(widths.filter(w => w <= wLo * 1.4 && w <= wHi + 1e-9).map(w => Math.round(w * 4) / 4 + 0.05))].sort((a, b) => a - b).slice(0, 10).forEach(w => cand.add(Math.max(w, wLo)));
      // Strips run either along Y (width W in X, limited in Y) or, transposed, along X (width W in Y,
      // limited in X). A tight rectangle with both limits is often only reachable one of the two ways.
      const tried = new Map();
      const limAlong = t => (t ? limX : limY);
      const hLimFor = t => (Number.isFinite(limAlong(t)) ? limAlong(t) : undefined);
      const phase1 = started + budget * 0.4;
      const keyOf = (W, t) => `${t ? 't' : 'n'}${Math.round(W * 100)}`;
      const trace = msg => { if (typeof process !== 'undefined' && process.env && process.env.NESTB_TRACE) console.error(`[B +${Date.now() - started} ms] ${msg}`); };
      const run = function* (W, t = false) {
        const key = keyOf(W, t);
        if (tried.has(key)) return;
        const r = yield* solveStrip(W, { hLimit: hLimFor(t), transposed: t, light: true, positions: Number.isFinite(limAlong(t)) ? 80 : 40 });
        tried.set(key, { W, t, r });
        if (typeof process !== 'undefined' && process.env && process.env.NESTB_TRACE) console.error(`  ${t ? 'T ' : ''}W=${W.toFixed(2)} -> ${r.count} parts, ${r.usedW.toFixed(1)} x ${r.H.toFixed(1)}`);
      };
      const ordered = [...cand].sort((x, y) => Math.abs(x - guess) - Math.abs(y - guess));
      const goodness = e => (e.r.count === prep.totalCount && (!Number.isFinite(limAlong(e.t)) || e.r.H <= limAlong(e.t) + 1e-9) ? 0 : 1e12) + e.r.usedW * e.r.H;
      const bestEntry = () => [...tried.values()].sort((a, b) => goodness(a) - goodness(b))[0];
      for (const W of ordered) {
        if (tried.size && Date.now() > phase1) break;
        yield* run(W);
      }
      // Transposed ladder: widths along Y, from the smallest orientation height up to the Y limit.
      if (Number.isFinite(limY)) {
        const heights = prep.orients.map(o => o.h);
        const hLo = Math.min(...heights);
        if (hLo <= limY + 1e-9) {
          const ladder = new Set([limY]);
          const hHi = Math.min(limY, Math.max(hLo, totalCount * (Math.max(...heights) + gap)));
          for (let k = 0; k <= 8; k++) ladder.add(hLo * Math.pow(Math.max(hHi, hLo * 1.0001) / hLo, k / 8));
          for (const W of [...ladder].sort((x, y) => y - x)) {
            if (Date.now() > phase1 + budget * 0.1) break;
            yield* run(W, true);
          }
        }
      }
      for (let round = 0; round < 2 && bestEntry() && Date.now() < phase1 + budget * 0.1; round++) {
        const e0 = bestEntry(), span = round === 0 ? 0.12 : 0.04;
        const lo = e0.t ? Math.min(...prep.orients.map(o => o.h)) : wLo, hi = e0.t ? limY : wHi;
        for (const f of [-2, -1, 1, 2]) yield* run(Math.min(hi, Math.max(lo, e0.W * (1 + f * span))), e0.t);
      }
      trace(`phase 1 done: ${tried.size} strips`);
      // Full effort on the most promising strips (distinct by 2%), splitting the remaining time.
      const finalists = [];
      for (const e of [...tried.values()].sort((a, b) => goodness(a) - goodness(b))) {
        if (finalists.every(f => f.t !== e.t || Math.abs(f.W - e.W) / f.W > 0.02)) finalists.push(e);
        if (finalists.length >= 3) break;
      }
      const finals = [];
      for (let i = 0; i < finalists.length; i++) {
        const f = finalists[i];
        const remaining = deadline - Date.now();
        const until = Date.now() + Math.max(0, remaining / (finalists.length - i)) * 0.95;
        trace(`finalist ${i + 1}/${finalists.length} ${f.t ? 'transposed ' : ''}W=${f.W.toFixed(1)} until +${until - started} ms`);
        // Constructions are cheap but not free with many orientations; the shrink loop gets the time.
        finals.push(yield* solveStrip(f.W, { hLimit: hLimFor(f.t), transposed: f.t, until, positions: Number.isFinite(limAlong(f.t)) ? 120 : 80, variantCount: 2 }));
      }
      trace('finals done');
      const all = [...finals, ...[...tried.values()].map(e => e.r)].filter(r => r.count > 0 && (!Number.isFinite(limAlong(r.transposed)) || r.H <= limAlong(r.transposed) + 1e-9));
      if (!all.length) {
        const limits = Number.isFinite(limX) && Number.isFinite(limY) ? 'the X/Y limits' : Number.isFinite(limY) ? 'the Y limit' : 'the X limit';
        throw Error(`No layout fits within ${limits}. Raise the limits or reduce the requested copies.`);
      }
      const most = Math.max(...all.map(r => r.count));
      const pick = all.filter(r => r.count === most).sort((a, b) => a.usedW * a.H - b.usedW * b.H)[0];
      ({ placements, frame } = tighten(prep, toLayout(prep, pick)));
    } else {
      throw Error('Unknown layout mode.');
    }

    const solvedMirrored = placements;
    const finalPlacements = mapBack(solvedMirrored, frame, mirror);
    if (finalPlacements.length !== totalCount) throw Error(`Only ${finalPlacements.length} of the ${totalCount} requested copies fit. Increase the limits or reduce the file copy counts.`);
    const check = verify(prep, finalPlacements, gap, frame);
    const nested = opts.holes ? findNested(prep, finalPlacements) : [];
    // With holes allowed, "used" is net material (outline minus the holes parts can sit in), so a part
    // nested in a hole never pushes the figure past 100%.
    const net = prep.realBases.map((regions, s) => (opts.holes
      ? regions.reduce((sum, reg) => sum + reg.reduce((a, ring, i) => a + (i === 0 || ringDepthEven(reg, i) ? 1 : -1) * polyArea(ring), 0), 0)
      : prep.oneAreas[s]));
    const partArea = finalPlacements.reduce((sum, p) => sum + net[p.sourceIndex], 0);
    return {
      engine: 'B', placements: finalPlacements, frame, count: finalPlacements.length, counts, gap, verify: check,
      nested, reorder: makeReorder(nested),
      utilization: partArea / (frame.w * frame.h || 1), partArea, sourceCount: sources.length,
      search: { ...search, ms: Date.now() - started, orientations: prep.orients.length, cell: c },
    };
  }

  function runSync(gen) {
    for (;;) {
      const r = gen.next();
      if (r.done) return r.value;
    }
  }
  const nest = (src, opts) => runSync(nestGen(src, opts));

  const api = { nestGen, nest, runSync, prepare, footprint, verify, sourceRegions, hullAngles, BUDGETS, _internals: { makePacker, greedy, chooseCell, VARIANTS, findLattices, tileLattice } };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.NestEngineB = api;
})(typeof window === 'undefined' ? globalThis : window);
