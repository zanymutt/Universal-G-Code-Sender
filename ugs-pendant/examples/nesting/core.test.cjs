const assert = require('node:assert/strict');
const fs = require('node:fs');
const C = require('./core.js');

let checks = 0;
const test = (name, fn) => { fn(); checks++; console.log('PASS ' + name); };
const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg || ''} expected ${b} got ${a}`);

const HEAD = ['G90 G94 G17', 'G21', 'G54'];
const FOOT = ['M5', 'G0 X0 Y0', 'M30'];
// Builds a plasma-style program that cuts one closed polygon with a pierce point at its first vertex.
function program(poly, { head = HEAD, foot = FOOT, arcs = [] } = {}) {
  const out = [...head, `G0 X${poly[0][0]} Y${poly[0][1]}`, 'G0 Z25', 'G53 G38.2 Z0 F200', '#100 = -3 ; probe', 'G10 L20 Z[#100]', 'M4 S1000', 'G4 P0.4', 'G1 Z2.5 F2500'];
  poly.slice(1).forEach(p => out.push(`G1 X${p[0]} Y${p[1]}`));
  out.push(`G1 X${poly[0][0]} Y${poly[0][1]}`, 'M5', 'G0 Z40', ...foot);
  return out.join('\n') + '\n';
}
const tri = program([[0, 0], [40, 0], [20, 30]]);
const square = (s) => program([[0, 0], [s, 0], [s, s], [0, s]]);
const contourPolys = (text) => C.extract(text).contours.filter(c => c.top).map(c => c.pts);

const sample = fs.readFileSync(__dirname + '/sample.gcode', 'utf8');

test('extract splits header / body / footer on the sample', () => {
  const s = C.extract(sample);
  assert.equal(s.lines[s.bodyStart], 'G0 X10 Y-6 F2500');
  assert.equal(s.lines[s.bodyEnd], 'G0 X0 Y0');
  assert.equal(s.contours.length, 1);
  assert.equal(s.warnings.length, 0);
  near(s.bbox.minX, 0, 1e-9); near(s.bbox.maxX, 40, 1e-9); near(s.bbox.minY, -6, 1e-9); near(s.bbox.maxY, 30, 1e-9);
});

test('analyze counts cut length, pierces, probes and dwell', () => {
  const a = C.analyze(sample, { rapid: 3000 });
  near(a.cutMM, 6 + 30 + 2 * Math.hypot(20, 30) + 10 + 6 + 0.5, 0.01, 'cut length');
  assert.equal(a.pierces, 1); assert.equal(a.probes, 1);
  near(a.dwell, 0.9, 1e-9);
});

test('non-motion lines, probe logic and footer survive every copy unchanged', () => {
  const s = C.extract(sample);
  const layout = { frame: { w: 100, h: 100 }, placements: [{ angle: 90, cx: 30, cy: 40 }, { angle: 0, cx: 70, cy: 40 }] };
  const out = C.buildGcode(s, layout, { origin: 'bottom-left', order: 'nest', tags: false }).text.split('\n');
  for (const keep of ['G53 G38.2 Z0 F200', '#100 = -3 ; default assume float switch trigger', 'o100 if [#5399 EQ 0]', 'G10 L20 Z[#100]', 'M4 S1000', 'G4 P0.4', 'M8', 'G4 p0.5', 'M9']) {
    assert.equal(out.filter(l => l === keep).length, 2, keep);
  }
  assert.equal(out.filter(l => l === 'M30').length, 1);
  assert.equal(out.filter(l => l === 'G0 X0 Y0').length, 1);
  assert.equal(out.at(-2), 'M30');
  assert.equal(out.slice(0, 5).join('|'), sample.split('\n').slice(0, 5).join('|'));
});

test('rotation + translation land the outline where the layout says', () => {
  const s = C.extract(program([[0, 0], [40, 0], [40, 10], [0, 10]]));
  const layout = { frame: { w: 100, h: 100 }, placements: [{ angle: 90, cx: 50, cy: 50 }] };
  const out = C.buildGcode(s, layout, { tags: false }).text;
  const box = C.extract(out).bbox;
  // 40 x 10 rotated 90 deg about its centre -> 10 x 40 centred on (50,50)
  near(box.minX, 45, 1e-3); near(box.maxX, 55, 1e-3); near(box.minY, 30, 1e-3); near(box.maxY, 70, 1e-3);
});

test('arcs (I/J, R, full circle) rotate as arcs and keep their geometry', () => {
  const text = ['G90 G21', 'G0 X10 Y0', 'M4 S1000', 'G1 X20 Y0', 'G3 X30 Y10 I0 J10', 'G2 X40 Y0 R10', 'G1 X20 Y-10', 'G1 X10 Y0', 'G2 X10 Y0 I5 J0', 'M5', 'G0 X0 Y0', 'M30'].join('\n') + '\n';
  const s = C.extract(text);
  for (const angle of [90, 37]) {
    const layout = { frame: { w: 200, h: 200 }, placements: [{ angle, cx: 100, cy: 100 }] };
    const out = C.buildGcode(s, layout, { tags: false }).text;
    const t = C.extract(out);
    const rad = angle * Math.PI / 180;
    const want = s.contours.flatMap(c => c.pts).map(p => ({ x: Math.cos(rad) * (p.x - s.center.x) - Math.sin(rad) * (p.y - s.center.y) + 100, y: Math.sin(rad) * (p.x - s.center.x) + Math.cos(rad) * (p.y - s.center.y) + 100 }));
    const got = t.contours.flatMap(c => c.pts);
    assert.equal(got.length, want.length);
    got.forEach((p, i) => { near(p.x, want[i].x, 2e-3, 'x'); near(p.y, want[i].y, 2e-3, 'y'); });
    assert.equal(out.split('\n').filter(l => /^G[23] /.test(l)).length, 3, 'arcs must stay arcs');
  }
});

test('modal lines with a single axis stay correct when rotated', () => {
  const text = ['G90 G21', 'G0 X0 Y0', 'M4', 'G1 X30 Y0', 'Y20', 'X0', 'Y0', 'M5', 'G0 X0 Y0', 'M30'].join('\n') + '\n';
  const s = C.extract(text);
  const layout = { frame: { w: 100, h: 100 }, placements: [{ angle: 90, cx: 50, cy: 50 }] };
  const out = C.buildGcode(s, layout, { tags: false }).text;
  const t = C.extract(out);
  const want = s.contours[0].pts.map(p => ({ x: -(p.y - s.center.y) + 50, y: (p.x - s.center.x) + 50 }));
  t.contours[0].pts.forEach((p, i) => { near(p.x, want[i].x, 1e-3); near(p.y, want[i].y, 1e-3); });
});

test('G91 relative moves rotate as vectors only', () => {
  const text = ['G90 G21', 'G0 X0 Y0', 'M4', 'G91', 'G1 X30 Y0', 'G1 X0 Y20', 'G1 X-30', 'G1 Y-20', 'G90', 'M5', 'G0 X0 Y0', 'M30'].join('\n') + '\n';
  const s = C.extract(text);
  const layout = { frame: { w: 100, h: 100 }, placements: [{ angle: 90, cx: 50, cy: 50 }] };
  const out = C.buildGcode(s, layout, { tags: false }).text;
  assert.ok(out.includes('G1 X0 Y30') || out.includes('G1 X0 Y30\n'), out);
  // The absolute start (G0 X0 Y0 before G91) is translated, so the shape as a whole lands on the layout position.
  const t = C.extract(out);
  const b = t.bbox;
  near(b.maxX - b.minX, 20, 1e-3); near(b.maxY - b.minY, 30, 1e-3);
});

test('inch programs are packed in mm and written back in inches', () => {
  const inch = ['G20 G90', 'G0 X0 Y0', 'M4', 'G1 X2 Y0', 'G1 X2 Y1', 'G1 X0 Y1', 'G1 X0 Y0', 'M5', 'G0 X0 Y0', 'M30'].join('\n') + '\n';
  const s = C.extract(inch);
  assert.equal(s.unit, 'in');
  const layout = C.nest(s, { mode: 'fixedX', count: 4, sizeX: 150, gap: 3, rotate: false });
  const out = C.buildGcode(s, layout, { tags: false }).text;
  const t = C.extract(out);
  assert.equal(t.mmPerUnit, 25.4);
  const shapes = t.contours.map(c => c.pts.map(p => ({ x: p.x * 25.4, y: p.y * 25.4 })));
  for (let i = 0; i < shapes.length; i++) for (let j = i + 1; j < shapes.length; j++) {
    assert.ok(C.shapeDistance([shapes[i]], [shapes[j]]) >= 3 - 1e-3, `pair ${i},${j}`);
  }
});

test('two triangles interlock (one inverted) instead of stacking', () => {
  const s = C.extract(tri.replace('G0 X0 Y0\nM30', 'G0 X0 Y0\nM30'));
  const r = C.nest(s, { mode: 'fixedX', count: 2, sizeX: 62, gap: 0, rotate: true, rotStep: 15 });
  assert.ok(r.frame.h < 33, 'height ' + r.frame.h + ' (stacked would be ~60)');
  assert.ok(r.verify.ok, JSON.stringify(r.verify));
  assert.ok(r.placements.some(p => Math.abs(p.angle - 180) < 1e-9), 'one copy should be inverted');
  const noRot = C.nest(s, { mode: 'fixedX', count: 2, sizeX: 62, gap: 0, rotate: false });
  assert.ok(noRot.frame.h > 55, 'without rotation they cannot interlock');
});

test('triangles tessellate into an alternating up/down row', () => {
  const s = C.extract(tri);
  const r = C.nest(s, { mode: 'fixedX', count: 8, sizeX: 300, gap: 0, rotate: true, rotStep: 15 });
  assert.ok(r.frame.h < 31.5, 'height ' + r.frame.h + ' (a lone row is 30)');
  const flips = r.placements.map(p => p.angle);
  assert.ok(flips.filter(a => a === 180).length >= 3 && flips.filter(a => a === 0).length >= 3, 'alternating orientations: ' + flips);
  assert.ok(r.verify.ok);
});

test('fixed height mirrors fixed width', () => {
  const s = C.extract(tri);
  const r = C.nest(s, { mode: 'fixedY', count: 2, sizeY: 62, gap: 0, rotate: true, rotStep: 15 });
  assert.ok(r.frame.w < 33, 'width ' + r.frame.w);
  assert.ok(r.frame.h <= 62 + 1e-9, 'the entered height is a maximum, the frame is what is used: ' + r.frame.h);
  assert.ok(r.verify.ok, JSON.stringify(r.verify));
});

test('minimum area finds a compact layout', () => {
  const s = C.extract(tri);
  const r = C.nest(s, { mode: 'minArea', count: 2, gap: 0, rotate: true, rotStep: 15 });
  assert.ok(r.frame.w * r.frame.h < 2100, 'area ' + r.frame.w * r.frame.h);
  assert.ok(r.verify.ok);
});

test('maximum parts on a sheet respects the gap', () => {
  const s = C.extract(square(10));
  const r = C.nest(s, { mode: 'maxParts', sizeX: 100, sizeY: 100, gap: 2, rotate: false });
  assert.ok(r.count >= 60, 'count ' + r.count);
  assert.ok(r.verify.ok, JSON.stringify(r.verify));
  const tight = C.nest(s, { mode: 'maxParts', sizeX: 100, sizeY: 100, gap: 0, rotate: false });
  assert.ok(tight.count >= 98, 'count ' + tight.count);
});

test('entered sizes are maximums: the frame is the tight bounding box of the result', () => {
  const s = C.extract(program([[0, 0], [160, 0], [160, 50], [0, 50]]));
  const fx = C.nest(s, { mode: 'fixedX', count: 3, sizeX: 1000, gap: 5, rotate: false });
  assert.ok(fx.frame.w < 500 && fx.frame.w > 160, 'width ' + fx.frame.w);
  const fy = C.nest(s, { mode: 'fixedY', count: 10, sizeY: 250, gap: 5, rotate: false });
  // four 50 mm parts and three 5 mm gaps fit in 250 (=215), so the frame must report that, not 250
  assert.ok(fy.frame.h < 225 && fy.frame.h >= 215 - 1e-6, 'height ' + fy.frame.h);
  assert.ok(fy.verify.ok, JSON.stringify(fy.verify));
  const ma = C.nest(s, { mode: 'minArea', count: 4, sizeX: 400, gap: 5, rotate: false });
  assert.ok(ma.frame.w <= 400 && ma.verify.ok);
});

test('compaction pulls parts toward the origin instead of leaving them where they landed', () => {
  const s = C.extract(program([[0, 0], [160, 0], [160, 50], [0, 50]]));
  const r = C.nest(s, { mode: 'fixedY', count: 10, sizeY: 250, gap: 5, rotate: false });
  // In each column the parts must be stacked at the gap: no part may float with slack below it.
  const byColumn = new Map();
  for (const p of r.placements) {
    const key = Math.round(p.cx);
    if (!byColumn.has(key)) byColumn.set(key, []);
    byColumn.get(key).push(p.cy);
  }
  for (const ys of byColumn.values()) {
    ys.sort((x, y) => x - y);
    ys.forEach((y, i) => { if (i) assert.ok(y - ys[i - 1] < 50 + 5 + 1.5, 'gap between stacked parts ' + (y - ys[i - 1] - 50)); });
    assert.ok(ys[0] < 25 + 1.5, 'bottom part sits on the floor: ' + ys[0]);
  }
});

test('the example built into the plugin matches sample.gcode (the sandboxed plugin cannot fetch files)', () => {
  const app = fs.readFileSync(__dirname + '/app.js', 'utf8');
  const m = app.match(/const SAMPLE = (\[.*?\])\.join/s);
  assert.ok(m, 'SAMPLE constant found in app.js');
  assert.equal(JSON.parse(m[1]).join('\n') + '\n', sample);
  assert.ok(!/fetch\(/.test(app), 'the plugin must not fetch its own files');
  assert.doesNotThrow(() => C.extract(sample));
});

test('result preference: compact never has a bigger frame than shortest-length, and is within 3% of its length', () => {
  // A 160 x 50 body with a 5 mm lead-in tip sticking out of the left side, like the ram-mount part.
  const tipped = C.extract(program([[-5, 25], [0, 25], [0, 0], [160, 0], [160, 50], [0, 50], [0, 25]]));
  const opts = { mode: 'fixedY', count: 10, sizeY: 250, gap: 5, rotate: false, effort: 5 };
  const compact = C.nest(tipped, { ...opts, prefer: 'compact' });
  const shortest = C.nest(tipped, { ...opts, prefer: 'length' });
  assert.ok(shortest.frame.w <= compact.frame.w + 1e-6, 'shortest is at least as short');
  assert.ok(compact.frame.w <= shortest.frame.w * 1.03 + 1e-6, 'compact is within 3% of the shortest length');
  assert.ok(compact.frame.w * compact.frame.h <= shortest.frame.w * shortest.frame.h + 1e-6, 'compact never has the bigger frame');
  assert.ok(compact.verify.ok && shortest.verify.ok);
});

test('a sheet too small for the part is a clear error', () => {
  const s = C.extract(square(50));
  assert.throws(() => C.nest(s, { mode: 'maxParts', sizeX: 30, sizeY: 30, gap: 1, rotate: false }), /does not fit/);
  assert.throws(() => C.nest(s, { mode: 'fixedX', count: 2, sizeX: 30, gap: 1, rotate: false }), /wider/);
});

test('random outlines never overlap or break the gap (exact check)', () => {
  let seed = 7;
  const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
  for (let trial = 0; trial < 6; trial++) {
    const n = 5 + Math.floor(rnd() * 6);
    const poly = [];
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2, r = 10 + rnd() * 25;
      poly.push([+(Math.cos(a) * r).toFixed(3), +(Math.sin(a) * r).toFixed(3)]);
    }
    const s = C.extract(program(poly));
    const gap = 1 + rnd() * 6;
    const modes = [
      { mode: 'fixedX', count: 9, sizeX: 160 },
      { mode: 'fixedY', count: 7, sizeY: 140 },
      { mode: 'minArea', count: 6 },
      { mode: 'maxParts', sizeX: 150, sizeY: 120 },
    ];
    for (const m of modes) {
      const r = C.nest(s, { ...m, gap, rotate: true, rotStep: 30 });
      assert.ok(r.verify.ok, `trial ${trial} ${m.mode}: ${JSON.stringify(r.verify)}`);
      assert.ok(r.count >= 1);
    }
  }
});

test('end to end: nested output re-parses to separated copies with one footer', () => {
  const s = C.extract(sample);
  const r = C.nest(s, { mode: 'fixedX', count: 6, sizeX: 130, gap: 5, rotate: true, rotStep: 15 });
  const g = C.buildGcode(s, r, { origin: 'top-left', order: 'nearest', gap: 5 });
  const lines = g.text.split('\n');
  assert.equal(lines.filter(l => l === 'M4 S1000').length, 6);
  assert.equal(lines.filter(l => l === 'M30').length, 1);
  const t = C.extract(g.text);
  const tops = t.contours.filter(c => c.top);
  assert.equal(tops.length, 6);
  for (let i = 0; i < tops.length; i++) for (let j = i + 1; j < tops.length; j++) {
    assert.ok(C.shapeDistance([tops[i].pts], [tops[j].pts]) >= 5 - 1e-3, `pair ${i},${j}`);
  }
  // top-left anchor: every point sits at x >= 0 and y <= 0
  const b = t.bbox;
  assert.ok(b.minX >= -1e-3 && b.maxY <= 1e-3, JSON.stringify(b));
  const a = C.analyze(g.text);
  assert.equal(a.pierces, 6); assert.equal(a.probes, 6);
});

test('origin anchors', () => {
  const f = { w: 100, h: 50 };
  assert.deepEqual(C.anchorPoint(f, 'top-left'), { x: 0, y: 50 });
  assert.deepEqual(C.anchorPoint(f, 'top-right'), { x: 100, y: 50 });
  assert.deepEqual(C.anchorPoint(f, 'bottom-right'), { x: 100, y: 0 });
  assert.deepEqual(C.anchorPoint(f, 'center'), { x: 50, y: 25 });
  assert.deepEqual(C.anchorPoint(f, 'custom', { x: 3, y: 4 }), { x: 3, y: 4 });
});

test('nearest ordering starts near the origin and chains parts', () => {
  const s = C.extract(square(10));
  const layout = { frame: { w: 100, h: 100 }, placements: [{ angle: 0, cx: 90, cy: 90 }, { angle: 0, cx: 10, cy: 10 }, { angle: 0, cx: 50, cy: 50 }] };
  const g = C.buildGcode(s, layout, { order: 'nearest', tags: false });
  assert.deepEqual(g.ordered.map(p => p.index), [1, 2, 0]);
});

test('files that cannot be repeated are refused with a reason', () => {
  assert.throws(() => C.extract(''), /empty/);
  assert.throws(() => C.extract('G21\nM30\n'), /No cutting moves/);
  assert.throws(() => C.extract('G21 G90\nG0 X0 Y0\nM4\nG1 X10 Y0\nG1 X10 Y10\nG91\nM5\nG0 X0 Y0\nM30\n'), /G90\/G91/);
});

// ---- multi-cut programs (Fusion-style: one torch cycle per contour, each with probe, pierce, pauses)
const circle = (cx, cy, r) => [[cx + r, cy], [cx, cy + r], [cx - r, cy], [cx, cy - r]];
// cuts[k] = { pts, lead: [x, y] }. The first cut opens with a lift to Z30; later cuts open on a modal XY move.
function cutProgram(cuts, { retract = 15 } = {}) {
  const out = ['G90 G94 G17', 'G21', 'G54'];
  cuts.forEach((c, k) => {
    const [lx, ly] = c.lead;
    if (k === 0) out.push(`G0 X${lx} Y${ly} F2000`, `G0 X${lx} Y${ly} Z30`);
    else out.push(`X${lx} Y${ly}`);
    out.push('', 'G38.2 Z-120 F200', 'F2000 G10 L20 Z-0.2', `G0 X${lx} Y${ly}  ; force position after probe`, 'Z3', 'M4 S1000', 'G4 P0.7', 'G1 Z1.5 F1200', 'M8');
    out.push(`G1 X${c.pts[0][0]} Y${c.pts[0][1]}`);
    c.pts.slice(1).forEach(p => out.push(`X${p[0]} Y${p[1]}`));
    out.push(`X${c.pts[0][0]} Y${c.pts[0][1]}`, `X${lx} Y${ly}`, 'M5 M9', 'G0 Z20', 'G4 P13.', 'G0 Z' + retract);
  });
  out.push('', 'M5', 'G0 X0 Y0', 'M30');
  return out.join('\n') + '\n';
}
const outerRect = { pts: [[0, 0], [60, 0], [60, 40], [0, 40]], lead: [-4, 20] };
const holeA = { pts: circle(15, 20, 6), lead: [15, 20] };
const holeB = { pts: circle(45, 20, 6), lead: [45, 20] };
const ram = cutProgram([holeA, holeB, outerRect]); // file order: holes first, like the Fusion post
const ramOuterFirst = cutProgram([outerRect, holeA, holeB]);

test('cut blocks: one per torch cycle, inner vs outer by containment', () => {
  const s = C.extract(ram);
  assert.equal(s.blocks.length, 3);
  assert.deepEqual(s.blocks.map(b => b.internal), [true, true, false]);
  assert.equal(s.lines[s.blocks[1].start], 'X45 Y20');
  assert.equal(s.lines[s.bodyEnd], 'G0 X0 Y0');
  assert.equal(s.safeZ, 30);
  const o = C.extract(ramOuterFirst);
  assert.deepEqual(o.blocks.map(b => b.internal), [false, true, true]);
  assert.equal(o.warnings.length, 0);
});

test('inner cuts of every part are made before any outer cut', () => {
  for (const source of [ram, ramOuterFirst]) {
    const s = C.extract(source);
    const r = C.nest(s, { mode: 'fixedX', count: 3, sizeX: 200, gap: 5, rotate: true, rotStep: 15 });
    const g = C.buildGcode(s, r, { order: 'nearest', gap: 5 });
    const expected = [true, true, true, true, true, true, false, false, false];
    assert.deepEqual(g.sequence.map(i => i.internal), expected);
    const lines = g.text.split('\n');
    assert.equal(lines.filter(l => l === 'M4 S1000').length, 9);
    assert.equal(lines.filter(l => l === 'G4 P13.').length, 9, 'every pause stays');
    assert.equal(lines.filter(l => l === 'G4 P0.7').length, 9);
    assert.equal(lines.filter(l => l === 'G38.2 Z-120 F200').length, 9);
    assert.equal(lines.filter(l => l === 'M30').length, 1);
    // Re-read the output: six inner cuts, then three outer cuts, every hole inside an outer.
    const t = C.extract(g.text);
    assert.deepEqual(t.blocks.map(b => b.internal), expected);
    const tops = t.contours.filter(c => c.top);
    for (const c of t.contours.filter(c => !c.top)) {
      assert.ok(tops.some(o => c.bbox.minX >= o.bbox.minX && c.bbox.maxX <= o.bbox.maxX && c.bbox.minY >= o.bbox.minY && c.bbox.maxY <= o.bbox.maxY));
    }
    for (let i = 0; i < tops.length; i++) for (let j = i + 1; j < tops.length; j++) {
      assert.ok(C.shapeDistance([tops[i].pts], [tops[j].pts]) >= 5 - 1e-3);
    }
  }
});

test('one part at a time keeps the file order inside each part', () => {
  const s = C.extract(ramOuterFirst);
  const r = C.nest(s, { mode: 'fixedX', count: 2, sizeX: 200, gap: 5, rotate: false });
  const g = C.buildGcode(s, r, { order: 'nest', cutOrder: 'part' });
  assert.deepEqual(g.sequence.map(i => [i.part.index, i.block]), [[0, 0], [0, 1], [0, 2], [1, 0], [1, 1], [1, 2]]);
});

test('a reordered program starts at the original start height', () => {
  const s = C.extract(ramOuterFirst);
  const r = C.nest(s, { mode: 'fixedX', count: 2, sizeX: 200, gap: 5, rotate: false });
  const lines = C.buildGcode(s, r, { order: 'nest', tags: false }).text.split('\n');
  const first = lines.findIndex(l => l.startsWith('X'));
  assert.equal(lines[first - 1], 'G0 Z30', 'lift before the first XY move');
  const one = C.nest(s, { mode: 'fixedX', count: 1, sizeX: 200, gap: 5, rotate: false });
  const inOrder = C.buildGcode(s, one, { cutOrder: 'part', tags: false }).text.split('\n');
  assert.equal(inOrder.filter(l => l === 'G0 Z30').length, 0, 'no extra lift when the original first cut goes first');
});

test('inherited feed and motion are restated when the neighbour changes', () => {
  const s = C.extract(ram);
  const b = { ...s.blocks[1], inheritsFeed: true, stateStart: { ...s.blocks[1].stateStart, f: 1200, motion: 0 } };
  const out = [];
  const map = C.makeMap(s, { angle: 0, tx: s.center.x, ty: s.center.y });
  C.emitBlock(s, b, map, 4, { ...b.stateStart, f: 800, motion: 1 }, out);
  assert.equal(out[0], 'F1200');
  assert.equal(out[1], 'G0 X45 Y20', 'modal first move gets the motion word its new neighbour did not leave behind');
});

test('files with tool changes or no approach move stay one block with a warning', () => {
  const s = C.extract(ram.replace('X45 Y20\n', 'M6 T2\nX45 Y20\n'));
  assert.equal(s.blocks.length, 1);
  assert.ok(s.warnings.some(w => /tools/.test(w)), s.warnings.join('|'));
  assert.equal(C.extract(ram.replace(/^X45 Y20\n/m, '')).blocks.length, 1);
});

// ---- pen / drag-knife programs (GRBL-Plotter style): no M3/M4/M5, cuts separated by lifts to the top Z
function penProgram(cuts, { top = 2, down = -1.5, swivelLift = false } = {}) {
  const out = ['F3000 (Setup - GCode-Header)', 'G90', 'G21 (use mm as unit)', `G00 Z${top}`];
  cuts.forEach((c, k) => {
    out.push(`(<Figure Id="${k + 1}"> )`, `G00 X${c.pts[0][0]} Y${c.pts[0][1]}  `, `G01 Z${down} F600 (PD)`);
    c.pts.slice(1).forEach((p, i) => {
      out.push(`G01 X${p[0]} Y${p[1]} F400 `);
      // Drag-knife corner swivel: lift only part way (not to the top), turn, lower again. Not a new cut.
      if (swivelLift && i === 1) out.push('G00 Z0.5', `G00 X${p[0]} Y${p[1] + 0.3}`, `G01 Z${down} F600`);
    });
    out.push(`G01 X${c.pts[0][0]} Y${c.pts[0][1]} F400`, `G00 Z${top} (PU)`, '(</Figure>)');
  });
  out.push('G0X0Y0 (Setup - GCode-Footer)', 'M30');
  return out.join('\n') + '\n';
}
const octagon = (cx, cy, r) => Array.from({ length: 8 }, (_, i) => [+(cx + r * Math.cos(i * Math.PI / 4)).toFixed(3), +(cy + r * Math.sin(i * Math.PI / 4)).toFixed(3)]);
const knifeOuter = { pts: [[0, 0], [60, 0], [60, 40], [0, 40]] };
const knifeHoleA = { pts: octagon(15, 20, 6) };
const knifeHoleB = { pts: octagon(45, 20, 6) };
const knife = penProgram([knifeHoleA, knifeHoleB, knifeOuter]);

test('pen-up/down programs split into cuts at the top Z, inner cuts detected', () => {
  const s = C.extract(knife);
  assert.equal(s.blocks.length, 3);
  assert.deepEqual(s.blocks.map(b => b.internal), [true, true, false]);
  assert.equal(s.warnings.length, 0);
  assert.equal(s.safeZ, undefined, 'the lift happens in the header, nothing to restate');
  assert.ok(s.lines[s.blocks[1].start].startsWith('(<Figure Id="2"'), 'a figure label travels with its cut');
  assert.deepEqual(C.extract(penProgram([knifeOuter, knifeHoleA, knifeHoleB])).blocks.map(b => b.internal), [false, true, true]);
});

test('drag-knife corner lifts to a lower Z do not split a cut', () => {
  const s = C.extract(penProgram([{ pts: [[0, 0], [30, 0], [30, 20], [0, 20]] }], { swivelLift: true }));
  assert.equal(s.blocks.length, 1);
  assert.equal(s.warnings.length, 0);
  const two = C.extract(penProgram([{ pts: [[0, 0], [30, 0], [30, 20], [0, 20]] }, { pts: [[40, 0], [70, 0], [70, 20], [40, 20]] }], { swivelLift: true }));
  assert.equal(two.blocks.length, 2, 'lifts to the top still separate cuts');
});

test('pen programs: inner cuts of every copy first, everything else verbatim', () => {
  for (const source of [knife, penProgram([knifeOuter, knifeHoleA, knifeHoleB])]) {
    const s = C.extract(source);
    const r = C.nest(s, { mode: 'fixedX', count: 3, sizeX: 200, gap: 4, rotate: true, rotStep: 15 });
    const g = C.buildGcode(s, r, { order: 'nearest', gap: 4 });
    const expected = [true, true, true, true, true, true, false, false, false];
    assert.deepEqual(g.sequence.map(i => i.internal), expected);
    const lines = g.text.split('\n');
    assert.equal(lines.filter(l => l === 'G01 Z-1.5 F600 (PD)').length, 9);
    assert.equal(lines.filter(l => l === 'G00 Z2 (PU)').length, 9);
    assert.equal(lines.filter(l => l.startsWith('G0X0Y0')).length, 1);
    assert.ok(!g.text.includes('Raise to the start height'), 'no extra lift for pen files');
    lines.forEach((l, i) => { if (l.startsWith('(<Figure') && i > 24) assert.ok(lines[i + 1].startsWith('G00 X'), 'label followed by its own approach: ' + lines[i + 1]); });
    const t = C.extract(g.text);
    assert.deepEqual(t.blocks.map(b => b.internal), expected);
    const tops = t.contours.filter(c => c.top);
    for (let i = 0; i < tops.length; i++) for (let j = i + 1; j < tops.length; j++) assert.ok(C.shapeDistance([tops[i].pts], [tops[j].pts]) >= 4 - 1e-3);
  }
});

const knifeFile = process.env.NEST_SAMPLE_KNIFE || '//MAIN-PC/05_network_shared_dup/plasma cnc/drag knife/mckena/kena_red_v3_cut_.gcode';
if (fs.existsSync(knifeFile)) {
  test('real GRBL-Plotter drag-knife file (local only)', () => {
    const s = C.extract(fs.readFileSync(knifeFile, 'utf8'));
    assert.deepEqual(s.blocks.map(b => b.internal), [true, true, false, false]);
    assert.equal(s.warnings.length, 0);
    const r = C.nest(s, { mode: 'fixedX', count: 3, sizeX: 200, gap: 4, rotate: true, rotStep: 15 });
    assert.ok(r.verify.ok, JSON.stringify(r.verify));
    const g = C.buildGcode(s, r, { order: 'nearest', gap: 4 });
    const lines = g.text.split('\n');
    assert.equal(lines.filter(l => l.startsWith('G01 Z') && l.includes('(PD)')).length, 12);
    assert.deepEqual(g.sequence.map(i => i.internal), [...Array(6).fill(true), ...Array(6).fill(false)]);
    assert.equal(C.extract(g.text).blocks.length, 12);
    const one = C.analyze(fs.readFileSync(knifeFile, 'utf8'));
    near(one.seconds, 75, 3, 'matches the 1:15 GRBL-Plotter reports');
  });
}

const heart = process.env.NEST_SAMPLE ||'//MAIN-PC/05_network_shared_dup/plasma cnc/1mm_noz/ronan/yeheart2.gcode';
if (fs.existsSync(heart)) {
  test('real Fusion/GRBL plasma file (local only)', () => {
    const s = C.extract(fs.readFileSync(heart, 'utf8'));
    assert.equal(s.lines[s.bodyEnd], 'G0 X0 Y0');
    const r = C.nest(s, { mode: 'fixedX', count: 8, sizeX: 300, gap: 4, rotate: true, rotStep: 15 });
    assert.ok(r.verify.ok, JSON.stringify(r.verify));
    const g = C.buildGcode(s, r, { origin: 'bottom-left', order: 'nearest', gap: 4 });
    const t = C.extract(g.text);
    assert.equal(t.contours.filter(c => c.top).length, 8);
    console.log(`      heart: ${r.count} parts in ${r.frame.w.toFixed(1)} x ${r.frame.h.toFixed(1)} mm, utilization ${(r.utilization * 100).toFixed(1)}%`);
  });
}

const ramFile = process.env.NEST_SAMPLE_RAM || '//MAIN-PC/05_network_shared_dup/plasma cnc/1mm_noz/ram dash mount/ramDashCut.gcode';
if (fs.existsSync(ramFile)) {
  test('real Fusion/GRBL file with two holes (local only)', () => {
    const s = C.extract(fs.readFileSync(ramFile, 'utf8'));
    assert.deepEqual(s.blocks.map(b => b.internal), [true, true, false]);
    assert.equal(s.warnings.length, 0);
    const r = C.nest(s, { mode: 'fixedX', count: 4, sizeX: 330, gap: 6, rotate: true, rotStep: 15 });
    assert.ok(r.verify.ok, JSON.stringify(r.verify));
    const g = C.buildGcode(s, r, { origin: 'bottom-left', order: 'nearest', gap: 6 });
    assert.deepEqual(g.sequence.map(i => i.internal), [...Array(8).fill(true), ...Array(4).fill(false)]);
    const a = C.analyze(g.text);
    assert.equal(a.pierces, 12); assert.equal(a.probes, 12);
    near(a.dwell, 12 * (0.7 + 13), 1e-6, 'every pause stays');
    const t = C.extract(g.text);
    assert.deepEqual(t.blocks.map(b => b.internal), g.sequence.map(i => i.internal));
  });
}

console.log(`${checks} nesting checks passed`);
