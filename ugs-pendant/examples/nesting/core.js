/*
 * Nesting core: G-code part extraction, outline packing, per-copy transform and analysis.
 * No DOM access, so it runs unchanged in Node for testing.
 *
 * Model: the loaded file is ONE part. It is split into
 *   header  - everything before the first X/Y move (modal setup), emitted once
 *   body    - first X/Y move .. last cut + its retract (approach, probe, pierce, cut), repeated per copy
 *   footer  - first X/Y move or M2/M30 after the last cut .. end (park, program end), emitted once
 * Every body line is copied verbatim except the X/Y (and arc I/J) words of plain G0-G3 moves,
 * which are rotated/translated. Probe macros, expressions, G10/G53/G92 lines, M-codes, dwells,
 * feeds and comments pass through untouched.
 */
(function (root) {
  'use strict';

  const TAU = Math.PI * 2;
  const EPS = 1e-9;
  // Arc flattening tolerance (mm). The solver pads the gap by this much so chord error cannot eat it.
  const FLAT_TOL = 0.01;
  const NON_TRANSFORM_G = new Set([10, 28, 28.1, 30, 30.1, 53, 92, 92.1, 92.2, 92.3, 38.2, 38.3, 38.4, 38.5]);

  const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
  const fmt = (v, digits) => {
    const s = Number(v.toFixed(digits)).toString();
    return s === '-0' ? '0' : s;
  };

  // ---------------------------------------------------------------- line parsing

  function splitComments(raw) {
    const parts = [];
    let cur = '';
    let inParen = false;
    const push = (text, code) => { if (text) parts.push({ text, code }); };
    for (let i = 0; i < raw.length; i++) {
      const ch = raw[i];
      if (inParen) {
        cur += ch;
        if (ch === ')') { push(cur, false); cur = ''; inParen = false; }
      } else if (ch === '(') {
        push(cur, true); cur = '('; inParen = true;
      } else if (ch === ';') {
        push(cur, true); push(raw.slice(i), false); cur = ''; break;
      } else {
        cur += ch;
      }
    }
    if (cur) push(cur, !inParen);
    return parts;
  }

  function parseLine(raw) {
    const parts = splitComments(raw);
    const code = parts.filter(p => p.code).map(p => p.text).join(' ');
    const info = { raw, parts, code, expr: /[{}#?[\]]/.test(code), g: [], m: [], w: {} };
    for (const m of code.matchAll(/([A-Za-z])\s*([+-]?(?:\d+\.?\d*|\.\d+))/g)) {
      const letter = m[1].toUpperCase();
      const value = parseFloat(m[2]);
      if (letter === 'G') info.g.push(value);
      else if (letter === 'M') info.m.push(value);
      else info.w[letter] = value;
    }
    return info;
  }

  const newState = () => ({ abs: true, inch: false, plane: 17, motion: null, x: undefined, y: undefined, z: undefined, f: undefined });
  const cloneState = st => ({ ...st });

  // GRBL's R-format arc centre, so R arcs resolve the same way the controller resolves them.
  function arcGeom(from, to, w, cw) {
    let cx, cy;
    if (w.I !== undefined || w.J !== undefined) {
      cx = from.x + (w.I ?? 0);
      cy = from.y + (w.J ?? 0);
    } else if (w.R !== undefined) {
      const dx = to.x - from.x, dy = to.y - from.y, d = Math.hypot(dx, dy);
      if (d < EPS) return null;
      let r = w.R;
      let h = -Math.sqrt(Math.max(0, 4 * r * r - d * d)) / d;
      if (!cw) h = -h;
      if (r < 0) h = -h;
      cx = from.x + 0.5 * (dx - dy * h);
      cy = from.y + 0.5 * (dy + dx * h);
    } else {
      return null;
    }
    const r0 = Math.hypot(from.x - cx, from.y - cy);
    const r1 = Math.hypot(to.x - cx, to.y - cy);
    const a0 = Math.atan2(from.y - cy, from.x - cx);
    const a1 = Math.atan2(to.y - cy, to.x - cx);
    let sweep = cw ? a0 - a1 : a1 - a0;
    while (sweep <= 1e-9) sweep += TAU;
    while (sweep > TAU + 1e-9) sweep -= TAU;
    return { cx, cy, r0, r1, a0, sweep, cw };
  }

  function flattenArc(arc, tol) {
    const r = Math.max(arc.r0, arc.r1);
    const step = r <= tol ? Math.PI / 2 : 2 * Math.acos(Math.max(0, 1 - tol / r));
    const n = Math.max(1, Math.min(4000, Math.ceil(arc.sweep / Math.max(step, 1e-3))));
    const pts = [];
    for (let k = 1; k <= n; k++) {
      const t = k / n;
      const a = arc.a0 + (arc.cw ? -1 : 1) * arc.sweep * t;
      const rr = arc.r0 + (arc.r1 - arc.r0) * t;
      pts.push({ x: arc.cx + rr * Math.cos(a), y: arc.cy + rr * Math.sin(a) });
    }
    return pts;
  }

  // Applies one line to the modal state and reports what it did. Mutates `st`.
  function advance(st, info) {
    const ev = {
      info, kind: null, from: { x: st.x, y: st.y, z: st.z }, to: null, arc: null,
      xform: false, xyWords: false, abs: st.abs, motion: null, feed: undefined,
      dwell: undefined, torchOn: false, torchOff: false, end: false, probe: false, machine: false,
    };
    const w = info.w;
    for (const g of info.g) {
      if (g === 90) st.abs = true;
      else if (g === 91) st.abs = false;
      else if (g === 20) st.inch = true;
      else if (g === 21) st.inch = false;
      else if (g === 17 || g === 18 || g === 19) st.plane = g;
      else if (g === 0 || g === 1 || g === 2 || g === 3) st.motion = g;
      else if (g === 80) st.motion = null;
    }
    ev.abs = st.abs;
    if (w.F !== undefined) st.f = w.F;
    ev.feed = st.f;
    ev.torchOn = info.m.includes(3) || info.m.includes(4);
    ev.torchOff = info.m.includes(5);
    ev.end = info.m.includes(2) || info.m.includes(30);
    if (info.g.includes(4) && w.P !== undefined) ev.dwell = w.P;
    ev.probe = info.g.some(g => g >= 38.2 && g <= 38.5);
    ev.machine = info.g.some(g => NON_TRANSFORM_G.has(g));

    const hasXY = 'X' in w || 'Y' in w;
    const hasAxis = hasXY || 'Z' in w;
    ev.xyWords = hasXY;

    if (info.expr) {
      // Expressions like X[#100+5] are opaque: the position they leave us at is unknown.
      for (const a of ['X', 'Y', 'Z']) {
        if (new RegExp(a + '\\s*[[#]', 'i').test(info.code)) st[a.toLowerCase()] = undefined;
      }
      return ev;
    }
    if (ev.machine) {
      // G53/G92/G28... act in another coordinate frame or reset it: stop trusting those axes.
      if (info.g.some(g => g === 92 || g === 92.1 || g === 92.2 || g === 92.3)) {
        for (const a of ['X', 'Y', 'Z']) if (a in w) st[a.toLowerCase()] = w[a];
      } else {
        for (const a of ['X', 'Y', 'Z']) if (a in w) st[a.toLowerCase()] = undefined;
      }
      return ev;
    }
    if (!hasAxis || st.motion === null) return ev;

    ev.motion = st.motion;
    const to = { x: st.x, y: st.y, z: st.z };
    for (const a of ['X', 'Y', 'Z']) {
      if (!(a in w)) continue;
      const k = a.toLowerCase();
      to[k] = st.abs ? w[a] : (st[k] === undefined ? undefined : st[k] + w[a]);
    }
    ev.to = to;
    ev.kind = ev.motion === 0 ? 'rapid' : ev.motion === 1 ? 'feed' : ev.motion === 2 ? 'cw' : 'ccw';
    if ((ev.kind === 'cw' || ev.kind === 'ccw') && st.plane === 17 && ev.from.x !== undefined && ev.from.y !== undefined
        && to.x !== undefined && to.y !== undefined) {
      ev.arc = arcGeom(ev.from, to, w, ev.kind === 'cw');
    }
    ev.xform = hasXY || 'I' in w || 'J' in w;
    st.x = to.x; st.y = to.y; st.z = to.z;
    return ev;
  }

  // ---------------------------------------------------------------- geometry helpers

  const polyArea = p => Math.abs(p.reduce((s, a, i) => { const b = p[(i + 1) % p.length]; return s + a.x * b.y - b.x * a.y; }, 0) / 2);

  function pointInPoly(pt, poly) {
    let inside = false;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const a = poly[i], b = poly[j];
      if ((a.y > pt.y) !== (b.y > pt.y) && pt.x < (b.x - a.x) * (pt.y - a.y) / (b.y - a.y) + a.x) inside = !inside;
    }
    return inside;
  }

  function bboxOf(points) {
    const b = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
    for (const p of points) {
      if (p.x < b.minX) b.minX = p.x;
      if (p.x > b.maxX) b.maxX = p.x;
      if (p.y < b.minY) b.minY = p.y;
      if (p.y > b.maxY) b.maxY = p.y;
    }
    return b;
  }

  const orient2 = (a, b, c) => (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
  function segIntersect(a, b, c, d) {
    const o1 = orient2(a, b, c), o2 = orient2(a, b, d), o3 = orient2(c, d, a), o4 = orient2(c, d, b);
    if (((o1 > 0 && o2 < 0) || (o1 < 0 && o2 > 0)) && ((o3 > 0 && o4 < 0) || (o3 < 0 && o4 > 0))) return true;
    const on = (p, q, r) => Math.min(p.x, q.x) - EPS <= r.x && r.x <= Math.max(p.x, q.x) + EPS && Math.min(p.y, q.y) - EPS <= r.y && r.y <= Math.max(p.y, q.y) + EPS;
    return (Math.abs(o1) < EPS && on(a, b, c)) || (Math.abs(o2) < EPS && on(a, b, d)) || (Math.abs(o3) < EPS && on(c, d, a)) || (Math.abs(o4) < EPS && on(c, d, b));
  }
  function pointSeg(p, a, b) {
    const dx = b.x - a.x, dy = b.y - a.y, l = dx * dx + dy * dy;
    const t = l ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / l)) : 0;
    return Math.hypot(p.x - a.x - t * dx, p.y - a.y - t * dy);
  }
  function segDist(a, b, c, d) {
    if (segIntersect(a, b, c, d)) return 0;
    return Math.min(pointSeg(a, c, d), pointSeg(b, c, d), pointSeg(c, a, b), pointSeg(d, a, b));
  }

  // Shortest distance between two shapes, each a list of implicitly closed polygons. 0 when they touch, cross or nest.
  function shapeDistance(A, B) {
    let best = Infinity;
    for (const pa of A) {
      for (const pb of B) {
        for (let i = 0; i < pa.length; i++) {
          const a1 = pa[i], a2 = pa[(i + 1) % pa.length];
          const ax0 = Math.min(a1.x, a2.x), ax1 = Math.max(a1.x, a2.x), ay0 = Math.min(a1.y, a2.y), ay1 = Math.max(a1.y, a2.y);
          for (let j = 0; j < pb.length; j++) {
            const b1 = pb[j], b2 = pb[(j + 1) % pb.length];
            if (Math.min(b1.x, b2.x) - best > ax1 || Math.max(b1.x, b2.x) + best < ax0 ||
                Math.min(b1.y, b2.y) - best > ay1 || Math.max(b1.y, b2.y) + best < ay0) continue;
            const d = segDist(a1, a2, b1, b2);
            if (d < best) { best = d; if (best === 0) return 0; }
          }
        }
      }
    }
    for (const pa of A) for (const pb of B) {
      if (pointInPoly(pa[0], pb) || pointInPoly(pb[0], pa)) return 0;
    }
    return best;
  }

  // ---------------------------------------------------------------- extraction

  // A cut block is one torch cycle (M3/M4 .. M5) with everything that belongs to it: the approach
  // move, probing, pierce, the cut, and the retract that follows. It starts at the first X/Y move
  // after the previous cycle's torch-off, so each block can be emitted on its own and reordered.
  // Files that cannot be split safely (no X/Y approach per cut, tool or work-offset changes) stay
  // one block, in file order.
  // Cutting cycles as {on, off} line indexes. Plasma/laser programs mark them with M3/M4 .. M5.
  // Pen, knife and plotter programs have no such commands, so a cycle there is a run of cutting moves
  // that ends when the tool retracts (a Z-only rapid) to the highest Z the program uses. Lifts to a
  // lower Z, such as the corner swivels of a drag knife, do not end a cycle.
  function findCycles(events, bodyStart, bodyEnd) {
    const cycles = [];
    let open = -1;
    for (let i = bodyStart; i < bodyEnd; i++) {
      if (events[i].torchOn && open < 0) open = i;
      else if (events[i].torchOff && open >= 0) { cycles.push({ on: open, off: i }); open = -1; }
    }
    if (cycles.length || events.slice(bodyStart, bodyEnd).some(ev => ev.torchOn)) return { cycles, mode: 'torch' };

    let top = events[bodyStart].from.z ?? -Infinity;
    for (let i = bodyStart; i < bodyEnd; i++) {
      const ev = events[i];
      if (ev.kind && ev.abs && ev.to && ev.to.z !== undefined && ev.to.z > top) top = ev.to.z;
    }
    if (!Number.isFinite(top)) return { cycles, mode: 'pen' };
    let first = -1, last = -1;
    for (let i = bodyStart; i < bodyEnd; i++) {
      const ev = events[i];
      if (ev.kind && ev.kind !== 'rapid' && ev.xyWords && ev.to) {
        if (first < 0) first = i;
        last = i;
      } else if (last >= 0 && ev.kind === 'rapid' && !ev.xyWords && ev.abs && ev.to.z >= top - 1e-6
                 && ev.from.z !== undefined && ev.to.z > ev.from.z + 1e-6) {
        cycles.push({ on: first, off: i });
        first = last = -1;
      }
    }
    if (last >= 0) cycles.push({ on: first, off: bodyEnd });
    return { cycles, mode: 'pen' };
  }

  function findBlocks(events, before, finalState, bodyStart, bodyEnd, total, warnings) {
    const { cycles, mode } = findCycles(events, bodyStart, bodyEnd);
    let starts = [bodyStart];
    const moves = [bodyStart]; // first X/Y move of each block (the start may be backed up over its label comments)
    let split = cycles.length > 1;
    let reason = '';
    for (let k = 1; split && k < cycles.length; k++) {
      let s = -1;
      let probedFirst = false;
      for (let i = cycles[k - 1].off + 1; i < cycles[k].on; i++) {
        if (events[i].kind && events[i].xyWords) { s = i; break; }
        if (events[i].probe) { probedFirst = true; break; }
      }
      if (s < 0) { split = false; reason = probedFirst ? 'a cut probes before moving to its own start' : 'a cut has no X/Y approach move of its own'; } else {
        // Take the comment/blank lines that introduce this cut (e.g. a figure label) along with it.
        moves.push(s);
        // (a closing tag such as (</Figure>) belongs to the cut before, so it stops the walk back)
        while (s - 1 > cycles[k - 1].off && events[s - 1].info.code.trim() === '' && !/^\s*\(\s*<\//.test(events[s - 1].info.raw)) s--;
        starts.push(s);
      }
    }
    for (let i = bodyStart + 1; split && i < bodyEnd; i++) {
      const info = events[i].info;
      if (info.m.includes(6) || 'T' in info.w) { split = false; reason = 'the program changes tools'; }
      else if (info.g.some(g => g >= 54 && g < 60)) { split = false; reason = 'the program changes work coordinate systems'; }
    }
    if (!split) {
      starts = [bodyStart];
      moves.length = 1;
      if (cycles.length > 1) warnings.push(`This file has ${cycles.length} ${mode === 'torch' ? 'torch' : 'pen-up/down'} cycles but ${reason}, so it is treated as one block and cannot be reordered.`);
    }
    return starts.map((s, k) => {
      const end = k + 1 < starts.length ? starts[k + 1] : bodyEnd;
      let last = null, seenFeed = false, inheritsFeed = false;
      for (let i = s; i < end; i++) {
        const ev = events[i];
        if (ev.info.w.F !== undefined) seenFeed = true;
        if (ev.kind && ev.kind !== 'rapid' && !seenFeed) inheritsFeed = true;
        if (ev.kind && ev.kind !== 'rapid' && ev.to && ev.xyWords && ev.to.x !== undefined && ev.to.y !== undefined) last = { x: ev.to.x, y: ev.to.y };
      }
      const move = moves[k];
      const first = { x: events[move].to.x ?? 0, y: events[move].to.y ?? 0 };
      return {
        start: s, move, end, stateStart: before[s], stateEnd: end < total ? before[end] : finalState,
        firstPoint: first, lastPoint: last || first, inheritsFeed, internal: false, contours: [],
      };
    });
  }

  function extract(text) {
    const eol = text.includes('\r\n') ? '\r\n' : '\n';
    const lines = text.split(/\r?\n/);
    if (lines.length && lines[lines.length - 1] === '') lines.pop();
    if (!lines.some(l => l.trim())) throw Error('The G-code is empty.');

    const st = newState();
    const infos = lines.map(parseLine);
    const before = [];
    const events = infos.map(info => { before.push(cloneState(st)); return advance(st, info); });
    const finalState = cloneState(st);

    const isMove = ev => ev.kind !== null && ev.xyWords;
    const firstMove = events.findIndex(isMove);
    let lastCut = -1;
    events.forEach((ev, i) => {
      if (ev.kind && ev.kind !== 'rapid' && ev.to && ev.xyWords) lastCut = i;
    });
    if (firstMove < 0 || lastCut < 0) throw Error('No cutting moves found. The file needs G1/G2/G3 moves with X/Y.');

    let footerStart = lines.length;
    for (let i = lastCut + 1; i < lines.length; i++) {
      if (isMove(events[i]) || events[i].end || (events[i].machine && events[i].xyWords)) { footerStart = i; break; }
    }
    const startState = before[firstMove];
    const endState = footerStart < lines.length ? before[footerStart] : finalState;
    if (startState.abs !== endState.abs || startState.inch !== endState.inch) {
      throw Error('The program changes G90/G91 or G20/G21 between the first move and the end, so it cannot be repeated safely.');
    }

    const warnings = [];
    const mmPerUnit = startState.inch ? 25.4 : 1;
    const tol = FLAT_TOL / mmPerUnit;

    const blocks = findBlocks(events, before, finalState, firstMove, footerStart, lines.length, warnings);
    // Height the file lifts to before its first cut (e.g. G0 X.. Y.. Z30). Only the first block does this;
    // the others rely on the previous block's retract, so a reordered program needs it restated.
    let safeZ;
    for (let i = blocks[0].start; i < blocks[0].end && safeZ === undefined; i++) {
      const ev = events[i];
      if (ev.torchOn || ev.probe || (ev.kind && ev.kind !== 'rapid')) break;
      if (ev.kind === 'rapid' && ev.abs && 'Z' in ev.info.w && ev.to.z !== undefined) safeZ = ev.to.z;
    }
    const blockOf = new Int32Array(lines.length);
    blocks.forEach((b, k) => blockOf.fill(k, b.start, b.end));

    // Cutting polylines -> contours, each tagged with the block that cuts it.
    const contours = [];
    let cur = null, curBlock = 0;
    const closeContour = () => { if (cur && cur.length > 1) contours.push({ pts: cur, block: curBlock }); cur = null; };
    let untouched = 0, badArcs = 0;
    for (let i = firstMove; i < footerStart; i++) {
      const ev = events[i];
      if (ev.xyWords && (ev.machine || ev.info.expr)) untouched++;
      if (ev.torchOff) closeContour();
      if (!ev.kind || !ev.xyWords) continue;
      if (ev.kind === 'rapid') { closeContour(); continue; }
      const { from, to } = ev;
      if (from.x === undefined || from.y === undefined || to.x === undefined || to.y === undefined) continue;
      if (dist(from, to) < EPS && !ev.arc) continue;
      if ((ev.kind === 'cw' || ev.kind === 'ccw') && !ev.arc) { badArcs++; }
      if (!cur || dist(cur[cur.length - 1], from) > 1e-4 / mmPerUnit) { closeContour(); cur = [{ x: from.x, y: from.y }]; curBlock = blockOf[i]; }
      if (ev.arc) cur.push(...flattenArc(ev.arc, tol));
      else cur.push({ x: to.x, y: to.y });
    }
    closeContour();
    if (!contours.length) throw Error('No cutting geometry found in the file.');
    if (untouched) warnings.push(`${untouched} move line(s) use machine coordinates or expressions and are copied unchanged.`);
    if (badArcs) warnings.push(`${badArcs} arc(s) could not be read (non-XY plane or missing I/J/R); they are ignored for packing.`);

    for (const c of contours) {
      c.area = polyArea(c.pts);
      c.bbox = bboxOf(c.pts);
      c.closed = dist(c.pts[0], c.pts[c.pts.length - 1]) < 1e-3 / mmPerUnit;
    }
    contours.sort((a, b) => b.area - a.area);
    contours.forEach((c, idx) => {
      const sample = c.pts.filter((_, k) => k % Math.max(1, Math.floor(c.pts.length / 20)) === 0);
      c.top = !contours.some((o, j) => {
        // Containers need not be closed: lead-in/out leave a small opening, but the implicit closing chord is short.
        if (j === idx || o.area <= c.area) return false;
        if (c.bbox.minX < o.bbox.minX - EPS || c.bbox.maxX > o.bbox.maxX + EPS || c.bbox.minY < o.bbox.minY - EPS || c.bbox.maxY > o.bbox.maxY + EPS) return false;
        return sample.filter(p => pointInPoly(p, o.pts)).length >= sample.length * 0.8;
      });
    });
    // A block is an inner cut when its biggest contour sits inside another contour.
    contours.forEach((c, idx) => { c.id = idx; blocks[c.block].contours.push(idx); });
    for (const b of blocks) if (b.contours.length) b.internal = !contours[b.contours[0]].top;
    const outline = contours.filter(c => c.top).map(c => c.pts);
    const box = bboxOf(outline.flat());
    const center = { x: (box.minX + box.maxX) / 2, y: (box.minY + box.maxY) / 2 };

    return {
      eol, lines, infos, events, mmPerUnit, unit: startState.inch ? 'in' : 'mm',
      bodyStart: firstMove, bodyEnd: footerStart, lastCut,
      startState, contours, blocks, safeZ, outline, center, bbox: box,
      firstPoint: { x: events[firstMove].to.x, y: events[firstMove].to.y },
      lastPoint: { x: events[lastCut].to.x, y: events[lastCut].to.y },
      area: outline.reduce((s, p) => s + polyArea(p), 0) * mmPerUnit * mmPerUnit,
      warnings,
    };
  }

  // ---------------------------------------------------------------- per-copy transform

  // place = { angle (deg CCW), tx, ty } : where the part's centre lands, in file units.
  function makeMap(src, place) {
    const rad = (place.angle * Math.PI) / 180;
    const cos = Math.cos(rad), sin = Math.sin(rad);
    const rotating = Math.abs(place.angle % 360) > 1e-9;
    const { center } = src;
    return {
      rotating,
      point: p => ({ x: cos * (p.x - center.x) - sin * (p.y - center.y) + place.tx, y: sin * (p.x - center.x) + cos * (p.y - center.y) + place.ty }),
      vec: (x, y) => ({ x: cos * x - sin * y, y: sin * x + cos * y }),
    };
  }

  function rewriteWords(info, values, digits) {
    const parts = info.parts.map(p => ({ ...p }));
    const seen = new Set();
    for (const part of parts) {
      if (!part.code) continue;
      part.text = part.text.replace(/(?<![A-Za-z])([XYIJxyij])(\s*)([+-]?(?:\d+\.?\d*|\.\d+))/g, (all, letter, _space, _num) => {
        const key = letter.toUpperCase();
        if (values[key] === undefined) return all;
        seen.add(key);
        return key + fmt(values[key], digits);
      });
    }
    const missing = Object.keys(values).filter(k => values[k] !== undefined && !seen.has(k));
    if (missing.length) {
      const last = [...parts].reverse().find(p => p.code);
      const add = missing.map(k => ' ' + k + fmt(values[k], digits)).join('');
      if (last) last.text = last.text.replace(/\s*$/, '') + add;
      else parts.unshift({ text: add.trim(), code: true });
    }
    return parts.map(p => p.text).join('');
  }

  function transformLine(src, index, map, digits, explicitMotion) {
    const ev = src.events[index];
    const raw = src.lines[index];
    if (!ev.xform || ev.kind === null) return raw;
    const w = ev.info.w;
    const values = {};
    let partial = false;
    if ('X' in w || 'Y' in w) {
      if (ev.abs) {
        if (ev.to.x !== undefined && ev.to.y !== undefined) {
          const p = map.point(ev.to);
          if (map.rotating || ('X' in w && 'Y' in w)) { values.X = p.x; values.Y = p.y; }
          else { if ('X' in w) values.X = p.x; if ('Y' in w) values.Y = p.y; }
        } else if (!map.rotating) {
          // The other axis is unknown (nothing positioned it yet); a pure translation still maps each axis alone.
          if ('X' in w) values.X = map.point({ x: w.X, y: 0 }).x;
          if ('Y' in w) values.Y = map.point({ x: 0, y: w.Y }).y;
        } else partial = true;
      } else {
        const d = map.vec('X' in w ? w.X : 0, 'Y' in w ? w.Y : 0);
        if (map.rotating || ('X' in w && 'Y' in w)) { values.X = d.x; values.Y = d.y; }
        else { if ('X' in w) values.X = d.x; if ('Y' in w) values.Y = d.y; }
      }
    }
    if ('I' in w || 'J' in w) {
      if (map.rotating) {
        const d = map.vec(w.I ?? 0, w.J ?? 0);
        values.I = d.x; values.J = d.y;
      }
    }
    if (partial) return raw;
    let out = rewriteWords(ev.info, values, digits);
    if (explicitMotion && !ev.info.g.some(g => g >= 0 && g <= 3)) out = 'G' + ev.motion + ' ' + out;
    return out;
  }

  // ---------------------------------------------------------------- output

  function anchorPoint(frame, origin, custom) {
    switch (origin) {
      case 'top-left': return { x: 0, y: frame.h };
      case 'top-right': return { x: frame.w, y: frame.h };
      case 'bottom-right': return { x: frame.w, y: 0 };
      case 'center': return { x: frame.w / 2, y: frame.h / 2 };
      case 'custom': return { x: Number(custom?.x) || 0, y: Number(custom?.y) || 0 };
      default: return { x: 0, y: 0 };
    }
  }

  // Where each placed part ends up in output coordinates (file units) and where each of its cut
  // blocks starts and ends.
  function resolvePlacements(src, layout, opts = {}) {
    const anchor = anchorPoint(layout.frame, opts.origin || 'bottom-left', opts.custom);
    const s = src.mmPerUnit;
    const parts = layout.placements.map((p, index) => {
      const place = { angle: p.angle, tx: (p.cx - anchor.x) / s, ty: (p.cy - anchor.y) / s };
      const map = makeMap(src, place);
      const blocks = src.blocks.map(b => ({ start: map.point(b.firstPoint), end: map.point(b.lastPoint) }));
      return { index, angle: p.angle, place, map, blocks, start: blocks[0].start, end: blocks[blocks.length - 1].end };
    });
    return { anchor, parts };
  }

  // Greedy nearest-next chain over items with {start, end}, beginning at `from`.
  function chain(items, from) {
    const left = items.slice();
    const result = [];
    let cur = from;
    while (left.length) {
      let bi = 0, bd = Infinity;
      left.forEach((p, i) => { const d = dist(cur, p.start); if (d < bd) { bd = d; bi = i; } });
      const [next] = left.splice(bi, 1);
      result.push(next);
      cur = next.end;
    }
    return result;
  }
  const orderParts = (parts, order) => (order === 'nearest' ? chain(parts, { x: 0, y: 0 }) : parts.slice());

  // The order every cut is made in across all copies.
  //   'phases' (default): inner cuts of every part first, then the outer cuts.
  //   'part': one complete part at a time, cuts in file order.
  // `order` picks the walk inside a phase (or across parts): 'nearest' reduces travel, 'nest' follows part numbers.
  function planSequence(src, parts, opts = {}) {
    const order = opts.order || 'nearest';
    const items = [];
    parts.forEach(p => src.blocks.forEach((b, bi) => items.push({
      part: p, block: bi, internal: b.internal, start: p.blocks[bi].start, end: p.blocks[bi].end,
    })));
    const phased = (opts.cutOrder || 'phases') === 'phases' && src.blocks.some(b => b.internal);
    if (!phased) {
      const walk = orderParts(parts, order);
      return walk.flatMap(p => items.filter(it => it.part === p));
    }
    const groups = [items.filter(it => it.internal), items.filter(it => !it.internal)];
    const seq = [];
    let cur = { x: 0, y: 0 };
    for (const g of groups) {
      const walk = order === 'nearest' ? chain(g, cur) : g;
      seq.push(...walk);
      if (walk.length) cur = walk[walk.length - 1].end;
    }
    return seq;
  }

  // Emits one block for one placed part. `prev` is the modal state the previous emitted line leaves
  // behind; anything the block inherited from its original neighbour is restated when the order changed.
  function emitBlock(src, block, map, digits, prev, out) {
    const start = block.stateStart;
    const restate = [];
    if (prev.abs !== start.abs) restate.push(start.abs ? 'G90' : 'G91');
    if (prev.plane !== start.plane) restate.push('G' + start.plane);
    if (block.inheritsFeed && start.f !== undefined && prev.f !== start.f) restate.push('F' + fmt(start.f, digits));
    if (restate.length) out.push(restate.join(' '));
    for (let i = block.start; i < block.end; i++) {
      const ev = src.events[i];
      const explicit = i === block.move && ev.motion !== null && prev.motion !== ev.motion;
      out.push(transformLine(src, i, map, digits, explicit));
    }
    return block.stateEnd;
  }

  function buildGcode(src, layout, opts = {}) {
    const { anchor, parts } = resolvePlacements(src, layout, opts);
    const sequence = planSequence(src, parts, opts);
    const digits = src.unit === 'in' ? 5 : 4;
    const out = [];
    for (let i = 0; i < src.bodyStart; i++) out.push(src.lines[i]);
    const multi = src.blocks.length > 1;
    if (opts.tags !== false) {
      out.push(`(Nested ${parts.length} copies of one part${opts.name ? ' - ' + String(opts.name).replace(/[()]/g, '') : ''})`);
      out.push(`(Min gap ${fmt(opts.gap ?? 0, 2)} mm - frame ${fmt(layout.frame.w, 2)} x ${fmt(layout.frame.h, 2)} mm - origin ${opts.origin || 'bottom-left'})`);
    }
    let prev = src.startState;
    if (sequence.length && sequence[0].block !== 0 && src.safeZ !== undefined) {
      if (opts.tags !== false) out.push('(Raise to the start height used by the original file before the first move)');
      out.push('G0 Z' + fmt(src.safeZ, digits));
      prev = { ...prev, motion: 0 };
    }
    sequence.forEach((item, n) => {
      if (opts.tags !== false) {
        const what = multi ? `${item.internal ? 'inner' : 'outer'} cut ${item.block + 1} of part` : 'part';
        out.push(`(Cut ${n + 1} of ${sequence.length}: ${what} ${item.part.index + 1}, rotated ${fmt(item.part.angle, 2)} deg)`);
      }
      prev = emitBlock(src, src.blocks[item.block], item.part.map, digits, prev, out);
    });
    for (let i = src.bodyEnd; i < src.lines.length; i++) out.push(src.lines[i]);
    const seenParts = [...new Set(sequence.map(it => it.part))];
    return { text: out.join(src.eol) + src.eol, anchor, parts, sequence, ordered: seenParts };
  }

  // Transformed contour polylines and cut numbering for the preview, in output mm.
  function previewGeometry(src, layout, opts = {}) {
    const { anchor, parts } = resolvePlacements(src, layout, opts);
    const sequence = planSequence(src, parts, opts);
    const s = src.mmPerUnit;
    const mm = p => ({ x: p.x * s, y: p.y * s });
    return {
      anchor,
      parts: parts.map(p => ({
        index: p.index, angle: p.angle,
        contours: src.contours.map(c => ({ top: c.top, closed: c.closed, block: c.block, pts: c.pts.map(q => mm(p.map.point(q))) })),
      })),
      sequence: sequence.map((it, n) => ({ seq: n + 1, part: it.part.index, block: it.block, internal: it.internal, start: mm(it.start), end: mm(it.end) })),
    };
  }

  // ---------------------------------------------------------------- analysis

  function analyze(text, opts = {}) {
    const rapidRate = opts.rapid > 0 ? opts.rapid : 3000;
    const st = newState();
    const res = { cutMM: 0, rapidMM: 0, seconds: 0, dwell: 0, pierces: 0, probes: 0, unknownFeed: 0 };
    let cutMin = 0, rapidMin = 0;
    for (const raw of text.split(/\r?\n/)) {
      const ev = advance(st, parseLine(raw));
      const s = st.inch ? 25.4 : 1;
      if (ev.dwell) res.dwell += ev.dwell;
      if (ev.torchOn) res.pierces++;
      if (ev.probe) res.probes++;
      if (!ev.kind || !ev.to) continue;
      const f = ev.from, t = ev.to;
      let len;
      if (ev.arc) {
        const dz = f.z !== undefined && t.z !== undefined ? t.z - f.z : 0;
        len = Math.hypot(((ev.arc.r0 + ev.arc.r1) / 2) * ev.arc.sweep, dz);
      } else {
        const dx = f.x !== undefined && t.x !== undefined ? t.x - f.x : 0;
        const dy = f.y !== undefined && t.y !== undefined ? t.y - f.y : 0;
        const dz = f.z !== undefined && t.z !== undefined ? t.z - f.z : 0;
        len = Math.hypot(dx, dy, dz);
      }
      len *= s;
      if (ev.kind === 'rapid') { res.rapidMM += len; rapidMin += len / rapidRate; }
      else {
        res.cutMM += len;
        if (ev.feed > 0) cutMin += len / (ev.feed * s); else if (len > 0) res.unknownFeed++;
      }
    }
    res.seconds = (cutMin + rapidMin) * 60 + res.dwell;
    return res;
  }

  // ---------------------------------------------------------------- packing

  function prepare(src, opts) {
    const s = src.mmPerUnit;
    const base = src.outline.map(poly => poly.map(p => ({ x: (p.x - src.center.x) * s, y: (p.y - src.center.y) * s })));
    const angles = [0];
    if (opts.rotate) {
      const step = Number(opts.rotStep);
      if (!(step > 0 && step <= 180)) throw Error('Rotation step must be between 0 and 180 degrees.');
      for (let a = step; a < 360 - 1e-9; a += step) angles.push(Math.round(a * 1e6) / 1e6);
    }
    const orients = angles.map(angle => {
      const rad = (angle * Math.PI) / 180, cos = Math.cos(rad), sin = Math.sin(rad);
      const polys = base.map(poly => poly.map(p => ({ x: p.x * cos - p.y * sin, y: p.x * sin + p.y * cos })));
      const b = bboxOf(polys.flat());
      return { angle, polys, minX: b.minX, minY: b.minY, maxX: b.maxX, maxY: b.maxY, w: b.maxX - b.minX, h: b.maxY - b.minY };
    });
    return { orients, area: base.reduce((sum, p) => sum + polyArea(p), 0) };
  }

  // Vertical extent (lowest/highest boundary point) of the shape in each x-column, then that profile
  // grown by radius R (Minkowski sum with a disc). Conservative in both axes, so profiles that do not
  // overlap guarantee shapes at least 2R apart.
  function footprint(polys, transposed, c, R) {
    const P = polys.map(poly => poly.map(p => (transposed ? { x: p.y, y: p.x } : p)));
    const b = bboxOf(P.flat());
    const Q = P.map(poly => poly.map(p => ({ x: p.x - b.minX, y: p.y - b.minY })));
    const width = b.maxX - b.minX, height = b.maxY - b.minY;
    const n = Math.max(1, Math.ceil(width / c - 1e-9));
    const lo = new Float64Array(n).fill(Infinity);
    const hi = new Float64Array(n).fill(-Infinity);
    for (const poly of Q) {
      for (let e = 0; e < poly.length; e++) {
        const a = poly[e], d = poly[(e + 1) % poly.length];
        const x0 = Math.min(a.x, d.x), x1 = Math.max(a.x, d.x);
        const i0 = Math.max(0, Math.floor(x0 / c) - 1), i1 = Math.min(n - 1, Math.floor(x1 / c));
        for (let i = i0; i <= i1; i++) {
          const xl = Math.max(x0, i * c), xr = Math.min(x1, (i + 1) * c);
          if (xl > xr + 1e-12) continue;
          let y1, y2;
          if (Math.abs(d.x - a.x) < 1e-12) { y1 = a.y; y2 = d.y; }
          else { y1 = a.y + (xl - a.x) / (d.x - a.x) * (d.y - a.y); y2 = a.y + (xr - a.x) / (d.x - a.x) * (d.y - a.y); }
          const l = Math.min(y1, y2), h = Math.max(y1, y2);
          if (l < lo[i]) lo[i] = l;
          if (h > hi[i]) hi[i] = h;
        }
      }
    }
    for (let i = 0; i < n; i++) {
      if (lo[i] !== Infinity) continue;
      let j = i - 1; while (j >= 0 && lo[j] === Infinity) j--;
      let k = i + 1; while (k < n && lo[k] === Infinity) k++;
      const src = j >= 0 ? j : k < n ? k : -1;
      lo[i] = src >= 0 ? lo[src] : 0; hi[i] = src >= 0 ? hi[src] : 0;
    }
    let top = -Infinity;
    for (let i = 0; i < n; i++) if (hi[i] > top) top = hi[i];
    const rd = R > 0 ? Math.ceil(R / c) + 1 : 0;
    const N = n + 2 * rd;
    const loD = new Float64Array(N).fill(Infinity);
    const hiD = new Float64Array(N).fill(-Infinity);
    for (let k = 0; k < N; k++) {
      const i = k - rd;
      for (let j = Math.max(0, i - rd); j <= Math.min(n - 1, i + rd); j++) {
        const dx = Math.max(0, Math.abs(i - j) - 1) * c;
        if (dx > R + 1e-12) continue;
        const v = Math.sqrt(Math.max(0, R * R - dx * dx));
        if (lo[j] - v < loD[k]) loD[k] = lo[j] - v;
        if (hi[j] + v > hiD[k]) hiD[k] = hi[j] + v;
      }
    }
    return { n, rd, N, loD, hiD, top, width, height };
  }

  function chooseCell(prep, gap) {
    const maxDim = Math.max(...prep.orients.map(o => Math.max(o.w, o.h)));
    // Column width bounds how much extra space each interface can waste (about two columns), so it
    // scales with the gap; the maxDim term keeps very large parts from producing huge profiles.
    const c = gap > 0 ? Math.min(1, Math.max(0.1, gap / 8)) : 0.25;
    return Math.max(c, maxDim / 1200);
  }

  // Packs one strip of width W that grows along +Y. Every placed part records, per x-column, the
  // (gap-padded) y-interval it occupies, so a later part may slide under an overhang or into a pocket
  // as long as no column interval overlaps. Yields progress; returns the placements.
  function* strip(prep, o, ctl) {
    const { c, W, gap } = o;
    const R = gap > 0 ? gap / 2 + FLAT_TOL : 0;
    const feet = prep.orients.map(or => footprint(or.polys, o.transposed, c, R));
    const nc = Math.max(1, Math.ceil(W / c - 1e-9));
    let cols = Array.from({ length: nc }, () => []);
    const limit = o.hLimit ?? Infinity;
    const maxParts = o.count ?? 5000;
    const positions = o.positions || 160;
    const placed = [];
    let H = 0, last = Date.now();

    const addIntervals = (target, f, i0, y) => {
      const base = i0 - f.rd;
      for (let k = 0; k < f.N; k++) {
        const col = base + k;
        if (col < 0 || col >= nc || f.loD[k] === Infinity) continue;
        target[col].push(y + f.loD[k], y + f.hiD[k]);
      }
    };
    const buildCols = skip => {
      const t = Array.from({ length: nc }, () => []);
      placed.forEach((p, i) => { if (i !== skip) addIntervals(t, feet[p.k], p.i0, p.y); });
      return t;
    };

    // Lowest y >= 0 (bbox bottom on the floor) at which no column interval overlaps.
    function lowest(f, i0) {
      const { loD, hiD, N, rd } = f;
      const base = i0 - rd;
      let y = 0;
      for (let pass = 0; pass < 1000; pass++) {
        let moved = false;
        for (let k = 0; k < N; k++) {
          const col = base + k;
          if (col < 0 || col >= nc || loD[k] === Infinity) continue;
          const list = cols[col];
          for (let q = 0; q < list.length; q += 2) {
            if (y + loD[k] < list[q + 1] - 1e-9 && y + hiD[k] > list[q] + 1e-9) { y = list[q + 1] - loD[k]; moved = true; }
          }
        }
        if (!moved) break;
      }
      return y;
    }
    function measure(f, i0) {
      const y = lowest(f, i0);
      const ytop = y + f.top;
      if (ytop > limit + 1e-9) return null;
      return { i0, y, ytop, cost1: Math.max(H, ytop), waste: undefined, f };
    }
    // Free height directly under the part, summed over its columns: how much dead space it leaves.
    function waste(r) {
      const { loD, N, rd } = r.f;
      const base = r.i0 - rd;
      let sum = 0;
      for (let k = 0; k < N; k++) {
        const col = base + k;
        if (col < 0 || col >= nc || loD[k] === Infinity) continue;
        const bottom = r.y + loD[k];
        let below = -R;
        const list = cols[col];
        for (let q = 1; q < list.length; q += 2) if (list[q] <= bottom + 1e-9 && list[q] > below) below = list[q];
        sum += bottom - below;
      }
      r.waste = sum * c;
    }
    // Ties: y/height differences below tol are column-discretisation noise, not real preference.
    const tol = (o.tieTol ?? 3) * c;
    const scoreMode = o.score || 'bl';
    const better = (a, b) => {
      if (!b) return true;
      if (scoreMode === 'waste') {
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

    while (placed.length < maxParts) {
      let best = null;
      for (let k = 0; k < feet.length; k++) {
        if (o.only && !o.only.has(k)) continue;
        const f = feet[k];
        const maxI0 = Math.floor((W - f.width) / c + 1e-9);
        if (maxI0 < 0) continue;
        const stride = Math.max(1, Math.ceil((maxI0 + 1) / positions));
        const coarse = [];
        const tryAt = i0 => {
          const r = measure(f, i0);
          if (!r) return null;
          if (best && r.cost1 > best.cost1 + 1e-6) return null;
          waste(r); r.k = k;
          return r;
        };
        for (let i0 = 0; ; i0 += stride) {
          if (i0 > maxI0) i0 = maxI0;
          const r = tryAt(i0);
          if (r) coarse.push(r);
          if (i0 >= maxI0) break;
        }
        coarse.sort((a, b) => (better(a, b) ? -1 : 1));
        let local = coarse[0] || null;
        if (stride > 1) {
          for (const seed of coarse.slice(0, 3)) {
            for (let i0 = Math.max(0, seed.i0 - stride + 1); i0 <= Math.min(maxI0, seed.i0 + stride - 1); i0++) {
              const r = tryAt(i0);
              if (r && better(r, local)) local = r;
            }
          }
        }
        if (local && better(local, best)) best = local;
        if (Date.now() - last > 40) {
          last = Date.now();
          yield { placed: placed.length };
          if (ctl && ctl.cancelled) throw Error('Nesting stopped.');
        }
      }
      if (!best) break;
      const f = best.f;
      const base = best.i0 - f.rd;
      for (let k = 0; k < f.N; k++) {
        const col = base + k;
        if (col < 0 || col >= nc || f.loD[k] === Infinity) continue;
        cols[col].push(best.y + f.loD[k], best.y + f.hiD[k]);
      }
      if (best.ytop > H) H = best.ytop;
      placed.push({ k: best.k, i0: best.i0, y: best.y, right: best.i0 * c + f.width });
      yield { placed: placed.length };
      if (ctl && ctl.cancelled) throw Error('Nesting stopped.');
    }
    // Compaction: greedy placement can leave a part hanging where it was first put. Take each part out,
    // let it fall toward the origin corner (lower y, then lower x) as far as the others allow, put it
    // back, and repeat until nothing moves. Only ever moves parts toward the origin, so the limits hold.
    if (placed.length > 1 && placed.length <= 400) {
      for (let round = 0; round < 8; round++) {
        let moved = false;
        const order = placed.map((_, i) => i).sort((a, b) => placed[a].y - placed[b].y || placed[a].i0 - placed[b].i0);
        for (const idx of order) {
          const p = placed[idx], f = feet[p.k];
          cols = buildCols(idx);
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
          if (bi !== p.i0 || by < p.y - 1e-6) { p.i0 = bi; p.y = by; p.right = bi * c + f.width; moved = true; }
          cols = buildCols(-1);
        }
        yield { placed: placed.length };
        if (ctl && ctl.cancelled) throw Error('Nesting stopped.');
        if (!moved) break;
      }
      H = placed.reduce((m, p) => Math.max(m, p.y + feet[p.k].top), 0);
    }
    return { placed, H, usedW: placed.reduce((m, p) => Math.max(m, p.right), 0), c, transposed: !!o.transposed };
  }

  // Scoring variants tried per solve; the best result wins. Greedy packing is chaotic, so a few
  // different tie-break rules reliably beat any single one.
  const VARIANTS = [{ score: 'bl', tieTol: 3 }, { score: 'waste' }, { score: 'bl', tieTol: 1 }, { score: 'bl', tieTol: 6 }, { score: 'bl', tieTol: 2 }];
  const resultKey = (r, areaMode) => (areaMode ? r.usedW * r.H : r.H);
  // prefer 'length': strictly the shortest result. prefer 'compact' (default): among results within 3%
  // of the shortest, the one with the smallest frame area. A slightly longer nest is often a much
  // tighter block (no staggered gaps), which matters more than a few mm of length.
  function* portfolio(prep, o, ctl, effort, areaMode, prefer = 'compact') {
    const results = [];
    const started = Date.now();
    for (const v of VARIANTS.slice(0, Math.max(1, effort))) {
      results.push(yield* strip(prep, { ...o, ...v }, ctl));
      if (Date.now() - started > 6000) break;
    }
    // A finer rotation step must never lose to a coarser one, but greedy packing is chaotic, so also
    // try just the quarter turns (fast: four orientations) and keep whichever is best.
    const quarter = new Set(prep.orients.map((or, k) => (Math.abs(or.angle % 90) < 1e-9 ? k : -1)).filter(k => k >= 0));
    if (effort >= 2 && quarter.size > 1 && quarter.size < prep.orients.length) {
      for (const v of VARIANTS) results.push(yield* strip(prep, { ...o, ...v, only: quarter }, ctl));
    }
    const most = Math.max(...results.map(r => r.placed.length));
    let pool = results.filter(r => r.placed.length === most);
    const shortest = Math.min(...pool.map(r => resultKey(r, areaMode)));
    const byLength = (x, y) => resultKey(x, areaMode) - resultKey(y, areaMode) || x.usedW - y.usedW;
    if (!areaMode && prefer === 'compact') {
      pool = pool.filter(r => resultKey(r, false) <= shortest * 1.03 + 1e-9);
      return pool.sort((x, y) => (x.usedW * x.H - y.usedW * y.H) || byLength(x, y))[0];
    }
    return pool.sort(byLength)[0];
  }

  // Solver frame -> layout (true X/Y) placements, with the source centre position for each.
  function toLayout(prep, r) {
    return r.placed.map(p => {
      const or = prep.orients[p.k];
      const bx = r.transposed ? p.y : p.i0 * r.c;
      const by = r.transposed ? p.i0 * r.c : p.y;
      return { k: p.k, angle: or.angle, cx: bx - or.minX, cy: by - or.minY };
    });
  }

  // Sizes the user enters are limits, not the nest's size: the frame is the tight bounding box of the
  // placed outlines, and the layout is shifted so that box starts at 0,0.
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

  function verify(prep, placements, gap, frame) {
    const shapes = placements.map(p => prep.orients[p.k].polys.map(poly => poly.map(q => ({ x: q.x + p.cx, y: q.y + p.cy }))));
    const boxes = shapes.map(sh => bboxOf(sh.flat()));
    let minGap = Infinity, outside = 0;
    const reach = gap + 2;
    boxes.forEach(b => {
      if (b.minX < -1e-6 || b.minY < -1e-6 || b.maxX > frame.w + 1e-6 || b.maxY > frame.h + 1e-6) outside++;
    });
    for (let i = 0; i < shapes.length; i++) {
      for (let j = i + 1; j < shapes.length; j++) {
        const a = boxes[i], b = boxes[j];
        if (a.minX - b.maxX > reach || b.minX - a.maxX > reach || a.minY - b.maxY > reach || b.minY - a.maxY > reach) continue;
        const d = shapeDistance(shapes[i], shapes[j]);
        if (d < minGap) minGap = d;
      }
    }
    return { minGap, outside, ok: outside === 0 && minGap >= gap - 1e-6 };
  }

  function* nestGen(src, opts, ctl) {
    const gap = Number(opts.gap);
    if (!(gap >= 0)) throw Error('Minimum gap must be 0 or more.');
    const mode = opts.mode;
    const prep = prepare(src, opts);
    if (!(prep.area > 0)) throw Error('The part outline has no area to pack.');
    const c = chooseCell(prep, gap);
    const base = { c, gap };
    const prefer = opts.prefer === 'length' ? 'length' : 'compact';
    const effort = Number(opts.effort) >= 1 ? Math.min(VARIANTS.length, Math.floor(Number(opts.effort))) : 3;
    const count = Math.floor(Number(opts.count));
    if (mode !== 'maxParts' && !(count >= 1 && count <= 2000)) throw Error('Number of parts must be from 1 to 2000.');
    const need = (v, label) => { if (!(v > 0)) throw Error(label + ' must be greater than 0.'); return v; };
    const fits = (dim, transposed) => prep.orients.some(o => (transposed ? o.h : o.w) <= dim + 1e-9);
    let placements, frame;

    if (mode === 'fixedX') {
      const W = need(Number(opts.sizeX), 'Maximum X');
      if (!fits(W, false)) throw Error('The part is wider than the maximum X in every allowed orientation.');
      const r = yield* portfolio(prep, { ...base, W, count }, ctl, effort, false, prefer);
      ({ placements, frame } = tighten(prep, toLayout(prep, r)));
    } else if (mode === 'fixedY') {
      const W = need(Number(opts.sizeY), 'Maximum Y');
      if (!fits(W, true)) throw Error('The part is taller than the maximum Y in every allowed orientation.');
      const r = yield* portfolio(prep, { ...base, W, count, transposed: true }, ctl, effort, false, prefer);
      ({ placements, frame } = tighten(prep, toLayout(prep, r)));
    } else if (mode === 'maxParts') {
      const sw = need(Number(opts.sizeX), 'Sheet X'), sh = need(Number(opts.sizeY), 'Sheet Y');
      if (!fits(sw, false) && !fits(sh, true)) throw Error('The part does not fit on that sheet in any allowed orientation.');
      let a = null, b = null;
      if (fits(sw, false)) a = yield* portfolio(prep, { ...base, W: sw, hLimit: sh }, ctl, effort, false, prefer);
      if (fits(sh, true)) b = yield* portfolio(prep, { ...base, W: sh, hLimit: sw, transposed: true }, ctl, effort, false, prefer);
      const pick = !b || (a && a.placed.length >= b.placed.length) ? a : b;
      if (!pick.placed.length) throw Error('No copy of the part fits on that sheet.');
      placements = toLayout(prep, pick); frame = { w: sw, h: sh };
    } else if (mode === 'minArea') {
      const limX = Number(opts.sizeX) > 0 ? Number(opts.sizeX) : Infinity;
      const limY = Number(opts.sizeY) > 0 ? Number(opts.sizeY) : Infinity;
      const widths = prep.orients.map(o => o.w);
      const wLo = Math.min(...widths), wMax = Math.max(...widths);
      if (wLo > limX + 1e-9) throw Error('The part is wider than the X limit in every allowed orientation.');
      const wHi = Math.min(limX, Math.max(wLo, count * (wMax + gap)));
      const meanArea = prep.orients[0].w * prep.orients[0].h;
      const guess = Math.min(wHi, Math.max(wLo, Math.sqrt(count * meanArea * 1.3)));
      const cand = new Set([guess]);
      for (let k = 0; k <= 12; k++) cand.add(wLo * Math.pow(Math.max(wHi, wLo * 1.0001) / wLo, k / 12));
      const started = Date.now();
      const budget = opts.budgetMs ?? 12000;
      const tried = new Map();
      let best = null;
      const run = function* (W, coarse) {
        const key = Math.round(W * 100);
        if (tried.has(key)) return;
        const r = yield* strip(prep, { ...base, W, count, positions: coarse ? 40 : 160 }, ctl);
        tried.set(key, r);
        const area = r.usedW * r.H;
        if (r.H <= limY + 1e-9 && (!best || area < best.area - 1e-9)) best = { W, area, r };
      };
      const order = [...cand].sort((x, y) => Math.abs(x - guess) - Math.abs(y - guess));
      for (const W of order) {
        if (best && Date.now() - started > budget) break;
        yield* run(W, true);
      }
      if (!best) throw Error('No layout fits within the Y limit. Raise the limits or reduce the number of parts.');
      for (let round = 0; round < 2 && Date.now() - started < budget * 1.5; round++) {
        const W0 = best.W, span = round === 0 ? 0.12 : 0.04;
        for (const f of [-2, -1, 1, 2]) {
          const W = Math.min(wHi, Math.max(wLo, W0 * (1 + f * span)));
          if (Date.now() - started > budget * 1.5) break;
          yield* run(W, true);
        }
      }
      const final = yield* portfolio(prep, { ...base, W: best.W, count }, ctl, effort, true, prefer);
      const finalArea = final.usedW * final.H;
      const chosen = final.H <= limY + 1e-9 && finalArea <= best.area + 1e-9 ? final : best.r;
      ({ placements, frame } = tighten(prep, toLayout(prep, chosen)));
    } else {
      throw Error('Unknown layout mode.');
    }

    const check = verify(prep, placements, gap, frame);
    const partArea = prep.area;
    return {
      placements, frame, count: placements.length, gap, verify: check,
      utilization: (placements.length * partArea) / (frame.w * frame.h || 1),
      partArea,
    };
  }

  function runSync(gen) {
    for (;;) {
      const r = gen.next();
      if (r.done) return r.value;
    }
  }
  const nest = (src, opts) => runSync(nestGen(src, opts));

  const api = {
    parseLine, advance, newState, extract, analyze, buildGcode, previewGeometry, resolvePlacements, orderParts, planSequence, emitBlock, anchorPoint,
    prepare, footprint, nestGen, nest, runSync, verify, shapeDistance, polyArea, pointInPoly, transformLine, makeMap, FLAT_TOL,
  };
  if (typeof module !== 'undefined') module.exports = api; else root.NestCore = api;
})(typeof window === 'undefined' ? globalThis : window);
