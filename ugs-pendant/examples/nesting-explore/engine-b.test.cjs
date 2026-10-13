// Checks for Engine B (engine-b.js). Engine A's own parser and G-code tests stay in
// ../nesting/core.test.cjs; this file only covers what B adds.
'use strict';
const assert = require('node:assert/strict');
const Core = require('./core.js');
const B = require('./engine-b.js');
const S = require('./samples.cjs');

let checks = 0;
const test = (name, fn) => { fn(); checks++; console.log('PASS ' + name); };
const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg || ''} expected ${b} got ${a}`);
const ex = text => Core.extract(text);
const quick = { budgetMs: 700, effort: 2, prefer: 'compact', origin: 'bottom-left' };

test('footprint of a plate with a hole has two runs per column through the hole', () => {
  const src = ex(S.shapes.washer(100, 64));
  // A hole smaller than the smallest file's outline cannot hold any copy, so a disc file is needed for it to count.
  const prep = B.prepare([src, ex(S.shapes.disc(10))], { counts: [1, 1], holes: true, rotate: false });
  const f = B.footprint(prep.orients[0], false, 0.5, 0);
  const mid = f.runs[Math.floor(f.n / 2)];
  assert.equal(mid.length, 4, 'two runs: below and above the hole');
  near(mid[0], 0, 1e-6); near(mid[3], 100, 1e-6);
  assert.ok(mid[1] > 15 && mid[1] < 20 && mid[2] > 80 && mid[2] < 85);
  const solid = B.prepare([src, ex(S.shapes.disc(10))], { counts: [1, 1], holes: false, rotate: false });
  assert.equal(B.footprint(solid.orients[0], false, 0.5, 0).runs[Math.floor(f.n / 2)].length, 2, 'without holes the plate is solid');
});

test('a zero-width lead-in spike counts as footprint (a pierce landing on a neighbour ruins it)', () => {
  const src = ex(require('node:fs').readFileSync(__dirname + '/sample.gcode', 'utf8'));
  const prep = B.prepare([src], { counts: [1], rotate: false, mirror: { x: false, y: false } });
  const f = B.footprint(prep.orients[0], false, 0.5, 0);
  near(f.top, 36, 1e-6, 'bbox height including the 6 mm lead-in');
  // the column under the lead-in (x = 10 of 0..40) reaches the bottom of the bounding box
  assert.ok(f.runs[Math.floor(10 / 0.5)][0] < 1e-6);
});

test('a C shape is a footprint with a gap, so a disc can sit in the notch', () => {
  const c = ex(S.shapes.cShape());
  const prep = B.prepare([c], { counts: [1], holes: false, rotate: false });
  const f = B.footprint(prep.orients[0], false, 0.5, 0);
  const runs = f.runs[f.n - 2];  // near the open side: top arm and bottom arm only
  assert.equal(runs.length, 4);
});

test('rotation conjugation: a part solved mirrored comes back unmirrored at the right angle', () => {
  // L shapes are chiral, so a wrong back-mapped angle would put the part's outline in the wrong place.
  const src = ex(S.shapes.lShape());
  for (const origin of ['bottom-left', 'bottom-right', 'top-left', 'top-right']) {
    const r = B.nest([src], { mode: 'fixedX', sizeX: 260, counts: [6], gap: 4, rotate: true, rotStep: 30, ...quick, origin });
    assert.ok(r.verify.ok, `${origin}: ${JSON.stringify(r.verify)}`);
    const g = Core.previewGeometry([src], r, { origin: 'bottom-left' });
    const tops = g.parts.map(p => p.contours.filter(c => c.top).map(c => c.pts));
    for (const outline of tops) {
      for (const poly of outline) {
        for (const p of poly) { assert.ok(p.x > -0.01 && p.x < r.frame.w + 0.01 && p.y > -0.01 && p.y < r.frame.h + 0.01, `${origin} inside frame`); }
      }
    }
    // Independent exact gap check using Engine A's distance code.
    for (let i = 0; i < tops.length; i++) for (let j = i + 1; j < tops.length; j++) assert.ok(Core.shapeDistance(tops[i], tops[j]) >= 4 - 1e-3, `${origin} gap`);
  }
});

test('compact nests grow from the chosen corner (sheet mode)', () => {
  const src = ex(S.shapes.rightTriangle());
  const near4 = {};
  for (const origin of ['bottom-left', 'bottom-right', 'top-left', 'top-right']) {
    const r = B.nest([src], { mode: 'maxParts', sizeX: 400, sizeY: 300, counts: [3], gap: 4, rotate: true, rotStep: 90, ...quick, origin });
    assert.ok(r.verify.ok);
    const g = Core.previewGeometry([src], r, { origin: 'bottom-left' });
    const pts = g.parts.flatMap(p => p.contours.flatMap(c => c.pts));
    const minX = Math.min(...pts.map(p => p.x)), maxX = Math.max(...pts.map(p => p.x));
    const minY = Math.min(...pts.map(p => p.y)), maxY = Math.max(...pts.map(p => p.y));
    near4[origin] = { left: minX < 400 - maxX, bottom: minY < 300 - maxY };
  }
  assert.deepEqual(near4['bottom-left'], { left: true, bottom: true });
  assert.deepEqual(near4['bottom-right'], { left: false, bottom: true });
  assert.deepEqual(near4['top-left'], { left: true, bottom: false });
  assert.deepEqual(near4['top-right'], { left: false, bottom: false });
});

test('parts in holes: discs fill the washer holes and shrink the nest, and it verifies', () => {
  const washer = ex(S.shapes.washer(100, 64)), disc = ex(S.shapes.disc(10));
  const base = { mode: 'fixedX', sizeX: 210, counts: [4, 8], gap: 3, rotate: false, ...quick, budgetMs: 1500 };
  const off = B.nest([washer, disc], { ...base, holes: false });
  const on = B.nest([washer, disc], { ...base, holes: true });
  assert.ok(off.verify.ok && on.verify.ok, JSON.stringify([off.verify, on.verify]));
  assert.ok(on.frame.h < off.frame.h - 20, `holes ${on.frame.h} vs ${off.frame.h}`);
  near(on.frame.h, 203, 4, 'two washer rows');
  // At least one disc really is inside a washer hole (independent geometric check).
  const g = Core.previewGeometry([washer, disc], on, { origin: 'bottom-left' });
  const washers = g.parts.filter(p => p.sourceIndex === 0).map(p => {
    const ring = p.contours.find(c => !c.top).pts;
    const b = ring.reduce((a, q) => ({ x: a.x + q.x / ring.length, y: a.y + q.y / ring.length }), { x: 0, y: 0 });
    return b;
  });
  const discs = g.parts.filter(p => p.sourceIndex === 1).map(p => p.contours[0].pts.reduce((a, q) => ({ x: a.x + q.x / p.contours[0].pts.length, y: a.y + q.y / p.contours[0].pts.length }), { x: 0, y: 0 }));
  const inside = discs.filter(d => washers.some(w => Math.hypot(d.x - w.x, d.y - w.y) < 32 - 10 + 0.5));
  assert.ok(inside.length >= 4, `${inside.length} discs in holes`);
  // The exact check also refuses a part that overlaps another's material.
  const bad = { ...on, placements: on.placements.map(p => ({ ...p })) };
  const w0 = bad.placements.find(p => p.sourceIndex === 0), d0 = bad.placements.find(p => p.sourceIndex === 1);
  d0.cx = w0.cx + 40; d0.cy = w0.cy;   // on the washer's solid rim
  const prep = B.prepare([washer, disc], { ...base, holes: true, mirror: { x: false, y: false } });
  prep.realBases = prep.bases;
  assert.ok(!B.verify(prep, bad.placements, 3, on.frame).ok);
});

test('a part inside a hole is cut before that hole, and the host outline comes after its hole', () => {
  const washer = ex(S.shapes.washer(100, 64)), disc = ex(S.shapes.disc(10));
  const r = B.nest([washer, disc], { mode: 'fixedX', sizeX: 210, counts: [4, 8], gap: 3, rotate: false, holes: true, ...quick, budgetMs: 1500 });
  assert.ok(r.nested.length >= 4, `nested ${r.nested.length}`);
  const plain = Core.buildGcode([washer, disc], r, { origin: 'bottom-left', order: 'nearest', gap: 3, tags: false });
  const fixed = Core.buildGcode([washer, disc], r, { origin: 'bottom-left', order: 'nearest', gap: 3, tags: false, reorder: r.reorder });
  assert.equal(fixed.sequence.length, plain.sequence.length);
  const pos = (seq, part, block) => seq.findIndex(it => it.part.index === part && it.block === block);
  for (const n of r.nested) {
    const hole = pos(fixed.sequence, n.host, n.block);
    const inner = fixed.sequence.map((it, i) => (it.part.index === n.inner ? i : -1)).filter(i => i >= 0);
    assert.ok(inner.every(i => i < hole), 'inner part is cut before the hole that holds it');
    const outline = fixed.sequence.findIndex(it => it.part.index === n.host && !it.internal);
    assert.ok(outline > hole, 'host outline is cut after its hole');
  }
  // Without the reorder the default order cuts every hole first, which is the case being fixed.
  assert.ok(r.nested.some(n => pos(plain.sequence, n.host, n.block) < plain.sequence.findIndex(it => it.part.index === n.inner)));
});

test('holes off keeps the plain outline: parts never go inside', () => {
  const washer = ex(S.shapes.washer(100, 64)), disc = ex(S.shapes.disc(10));
  const r = B.nest([washer, disc], { mode: 'fixedX', sizeX: 210, counts: [4, 8], gap: 3, rotate: false, holes: false, ...quick });
  assert.ok(r.verify.ok);
  assert.ok(r.frame.h > 225);
});

test('hull-edge angles are added to the step grid and never break a verified nest', () => {
  const src = ex(S.shapes.rightTriangle());
  const withEdges = B.prepare([src], { counts: [1], rotate: true, rotStep: 90, mirror: { x: false, y: false } });
  const without = B.prepare([src], { counts: [1], rotate: true, rotStep: 90, edgeAngles: false, mirror: { x: false, y: false } });
  assert.equal(without.orients.length, 4);
  assert.ok(withEdges.orients.length > 4);
  assert.ok(withEdges.orients.some(o => !o.onGrid));
  const r = B.nest([src], { mode: 'fixedX', sizeX: 300, counts: [9], gap: 3, rotate: true, rotStep: 90, ...quick });
  assert.ok(r.verify.ok);
});

test('B is never worse than A on triangles and keeps every requested copy', () => {
  const src = ex(S.shapes.rightTriangle());
  const common = { mode: 'fixedX', sizeX: 400, counts: [14], gap: 3, rotate: true, rotStep: 15, effort: 3, prefer: 'compact', origin: 'bottom-left' };
  const a = Core.nest([src], common);
  const b = B.nest([src], { ...common, budgetMs: 2500 });
  assert.equal(b.count, 14);
  assert.ok(b.verify.ok);
  assert.ok(b.frame.w * b.frame.h <= a.frame.w * a.frame.h * 1.001, `B ${b.frame.w * b.frame.h} vs A ${a.frame.w * a.frame.h}`);
});

test('output of B survives the G-code round trip with one footer', () => {
  const washer = ex(S.shapes.washer(100, 64)), disc = ex(S.shapes.disc(10));
  const r = B.nest([washer, disc], { mode: 'fixedX', sizeX: 210, counts: [4, 8], gap: 3, rotate: true, rotStep: 45, holes: true, ...quick, budgetMs: 1500 });
  const g = Core.buildGcode([washer, disc], r, { origin: 'bottom-left', order: 'nearest', gap: 3, tags: false });
  const lines = g.text.split('\n');
  assert.equal(lines.filter(l => l === 'M30').length, 1);
  const back = Core.extract(g.text);
  assert.equal(back.contours.length, 4 * 2 + 8);
  // (Re-extracting a multi-file program reports one block because the second file's G54 repeats; that is Engine A's rule.)
  assert.equal(lines.filter(l => l === 'M4 S1000').length, 16);
});

test('lattice seeding never loses to the same search without it, and verifies', () => {
  const src = ex(S.shapes.rightTriangle());
  const o = { mode: 'fixedX', sizeX: 400, counts: [40], gap: 3, rotate: true, rotStep: 15, effort: 3, prefer: 'compact', origin: 'bottom-left', budgetMs: 5000 };
  const off = B.nest([src], { ...o, lattice: false });
  const on = B.nest([src], { ...o, lattice: true });
  assert.ok(on.verify.ok && off.verify.ok);
  assert.equal(on.count, 40);
  assert.ok(on.frame.w * on.frame.h <= off.frame.w * off.frame.h * 1.001, `lattice ${on.frame.w * on.frame.h} vs ${off.frame.w * off.frame.h}`);
  assert.ok(on.search.lattice, 'a lattice seed was constructed');
});

test('cancel stops the search with the same error as Engine A', () => {
  const src = ex(S.shapes.wedge());
  const ctl = { cancelled: false };
  const gen = B.nestGen([src], { mode: 'fixedX', sizeX: 300, counts: [10], gap: 3, rotate: true, rotStep: 15, ...quick }, ctl);
  gen.next();
  ctl.cancelled = true;
  assert.throws(() => { for (;;) { if (gen.next().done) break; } }, /Nesting stopped/);
});

console.log(`${checks} Engine B checks passed`);
