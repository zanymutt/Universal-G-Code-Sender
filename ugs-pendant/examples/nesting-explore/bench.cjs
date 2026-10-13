// Engine A (core.js, the shipping Nesting plugin) vs Engine B (engine-b.js) on a fixed corpus.
//
//   node bench.cjs                    all cases, tier quick
//   node bench.cjs --tier=medium      B search time tier: quick | medium | long
//   node bench.cjs --budget=45000     B budget in ms (overrides the tier's time)
//   node bench.cjs --only=heart,holes case-name filter (substring, comma separated)
//   node bench.cjs --holes=0          B without parts-in-holes (default 1 for the hole cases only)
//
// Files under the MAIN-PC share are the user's real parts and are skipped when unreachable.
'use strict';
const fs = require('node:fs');
const Core = require('./core.js');
const B = require('./engine-b.js');
const S = require('./samples.cjs');

const args = Object.fromEntries(process.argv.slice(2).map(a => { const m = a.match(/^--([^=]+)=?(.*)$/); return m ? [m[1], m[2] || '1'] : []; }));
const tier = args.tier || 'quick';
const budgetMs = Number(args.budget) || undefined;   // default: the tier's own budget (quick 12 s, medium 45 s, long 100 s)
const only = args.only ? args.only.split(',') : null;
const SHARE = '//MAIN-PC/05_network_shared_dup/plasma cnc/';
const real = {
  avakey: SHARE + '1mm_noz/mckena/avakey_v3.gcode',
  heart: SHARE + '1mm_noz/ronan/yeheart2.gcode',
  ram: SHARE + '1mm_noz/ram dash mount/ramDashCut.gcode',
  knife: SHARE + 'drag knife/mckena/kena_red_v3_cut_.gcode',
  bama: SHARE + '1mm_noz/mckena/bamaA/svg2gcode4.gcode',
  bamaA: SHARE + '1mm_noz/mckena/bamaA.gcode',
  kena: SHARE + '1mm_noz/mckena/kena.gcode',
};
const load = {
  ...Object.fromEntries(Object.entries(real).map(([k, p]) => [k, () => (fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : null)])),
  wedge: S.shapes.wedge, L: S.shapes.lShape, C: S.shapes.cShape, U: S.shapes.uShape, trap: S.shapes.trapezoid, tri: S.shapes.rightTriangle,
  disc25: () => S.shapes.disc(25), disc10: () => S.shapes.disc(10), disc15: () => S.shapes.disc(15),
  washer: () => S.shapes.washer(100, 64), frame: S.shapes.frame,
};

const rot = { rotate: true, rotStep: 15 };
const cases = [
  { name: 'avakey x8 fixedX300', files: { avakey: 8 }, o: { mode: 'fixedX', sizeX: 300, gap: 3, ...rot } },
  { name: 'bama svg2gcode4 x7 minArea 200x300 gap5', files: { bama: 7 }, o: { mode: 'minArea', sizeX: 200, sizeY: 300, gap: 5, ...rot } },
  { name: 'bama svg2gcode4 x12 minArea 300x300 gap5', files: { bama: 12 }, o: { mode: 'minArea', sizeX: 300, sizeY: 300, gap: 5, ...rot } },
  { name: 'bamaA x9 minArea Y300 gap4', files: { bamaA: 9 }, o: { mode: 'minArea', sizeY: 300, gap: 4, ...rot } },
  { name: 'kena x6 minArea 300x250 gap4', files: { kena: 6 }, o: { mode: 'minArea', sizeX: 300, sizeY: 250, gap: 4, ...rot } },
  { name: 'avakey x100 fixedX600', files: { avakey: 100 }, o: { mode: 'fixedX', sizeX: 600, gap: 3, ...rot } },
  { name: 'avakey x20 fixedX400', files: { avakey: 20 }, o: { mode: 'fixedX', sizeX: 400, gap: 3, ...rot } },
  { name: 'heart x8 fixedX300', files: { heart: 8 }, o: { mode: 'fixedX', sizeX: 300, gap: 4, ...rot } },
  { name: 'ram x4 fixedX330', files: { ram: 4 }, o: { mode: 'fixedX', sizeX: 330, gap: 6, ...rot } },
  { name: 'knife x3 fixedX200', files: { knife: 3 }, o: { mode: 'fixedX', sizeX: 200, gap: 4, ...rot } },
  { name: 'mix avakey4 heart4 ram2 minArea', files: { avakey: 4, heart: 4, ram: 2 }, o: { mode: 'minArea', sizeY: 400, gap: 4, ...rot } },
  { name: 'mix avakey6 heart3 maxParts 400x300', files: { avakey: 6, heart: 3 }, o: { mode: 'maxParts', sizeX: 400, sizeY: 300, gap: 4, ...rot } },
  { name: 'wedge x20 maxParts 400x176 (A needs 181)', files: { wedge: 20 }, o: { mode: 'maxParts', sizeX: 400, sizeY: 176, gap: 3, ...rot } },
  { name: 'wedge x20 fixedX400', files: { wedge: 20 }, o: { mode: 'fixedX', sizeX: 400, gap: 3, ...rot } },
  { name: 'wedge x20 fixedX400 step90', files: { wedge: 20 }, o: { mode: 'fixedX', sizeX: 400, gap: 3, rotate: true, rotStep: 90 } },
  { name: 'tri x30 fixedX400', files: { tri: 30 }, o: { mode: 'fixedX', sizeX: 400, gap: 3, ...rot } },
  { name: 'trap x24 fixedX500', files: { trap: 24 }, o: { mode: 'fixedX', sizeX: 500, gap: 3, ...rot } },
  { name: 'L x12 fixedX400', files: { L: 12 }, o: { mode: 'fixedX', sizeX: 400, gap: 3, ...rot } },
  { name: 'C x8 + disc25 x8 fixedX400', files: { C: 8, disc25: 8 }, o: { mode: 'fixedX', sizeX: 400, gap: 3, ...rot } },
  { name: 'U x10 fixedX400', files: { U: 10 }, o: { mode: 'fixedX', sizeX: 400, gap: 3, ...rot } },
  { name: 'mixed L,U,C,tri,trap x5 each minArea', files: { L: 5, U: 5, C: 5, tri: 5, trap: 5 }, o: { mode: 'minArea', sizeY: 500, gap: 3, ...rot } },
  { name: 'holes: washer x4 + disc10 x8 fixedX210', files: { washer: 4, disc10: 8 }, o: { mode: 'fixedX', sizeX: 210, gap: 3, ...rot }, holes: true },
  { name: 'holes: frame x3 + disc15 x6 + disc10 x6 fixedX330', files: { frame: 3, disc15: 6, disc10: 6 }, o: { mode: 'fixedX', sizeX: 330, gap: 3, ...rot }, holes: true },
];

const now = () => Date.now();
const f1 = v => v.toFixed(1);
function row(label, r, ms) {
  if (!r) return `${label.padEnd(9)}  (failed)`;
  const area = r.frame.w * r.frame.h;
  return `${label.padEnd(9)}  ${String(r.count).padStart(3)} parts  ${f1(r.frame.w).padStart(7)} x ${f1(r.frame.h).padEnd(7)} area ${(area / 100).toFixed(0).padStart(6)} cm2  util ${(r.utilization * 100).toFixed(1).padStart(5)}%  gap ${Number.isFinite(r.verify.minGap) ? r.verify.minGap.toFixed(2) : '  - '}${r.verify.ok ? '' : '  VERIFY FAILED'}  ${(ms / 1000).toFixed(1)} s`;
}

const summary = [];
for (const cs of cases) {
  if (only && !only.some(s => cs.name.toLowerCase().includes(s.toLowerCase()))) continue;
  const names = Object.keys(cs.files);
  const texts = names.map(n => load[n]());
  if (texts.some(t => !t)) { console.log(`SKIP ${cs.name} (file not reachable)`); continue; }
  const sources = texts.map(t => Core.extract(t));
  const opts = { effort: 3, ...cs.o, counts: names.map(n => cs.files[n]), prefer: 'compact', origin: cs.origin || 'bottom-left' };
  console.log(`\n${cs.name}`);
  let a = null, b = null, bh = null;
  let t0 = now();
  try { a = Core.nest(sources, opts); } catch (e) { console.log('  A error: ' + e.message); }
  const ta = now() - t0;
  console.log('  ' + row('A', a, ta));
  const bOpts = { ...opts, budget: tier, budgetMs };
  t0 = now();
  try { b = B.nest(sources, { ...bOpts, holes: false }); } catch (e) { console.log('  B error: ' + e.stack); }
  const tb = now() - t0;
  console.log('  ' + row('B', b, tb) + (b ? `   [${b.search.orientations} orients, ${b.search.attempts} shrink tries, ${b.search.accepted} accepted]` : ''));
  let tbh = 0;
  if (cs.holes) {
    t0 = now();
    try { bh = B.nest(sources, { ...bOpts, holes: true }); } catch (e) { console.log('  B+holes error: ' + e.stack); }
    tbh = now() - t0;
    console.log('  ' + row('B+holes', bh, tbh));
  }
  // Every result must also survive the real G-code round trip.
  for (const [label, r] of [['A', a], ['B', b], ['B+holes', bh]]) {
    if (!r) continue;
    const g = Core.buildGcode(sources, r, { origin: cs.origin || 'bottom-left', order: 'nearest', gap: opts.gap, tags: false });
    const tops = Core.extract(g.text).contours.filter(c => c.top).length;
    if (!cs.holes && tops !== r.count * sources.reduce((s, x) => s + x.contours.filter(c => c.top).length, 0) / sources.length && sources.length === 1) console.log(`  ${label}: round trip has ${tops} outer contours`);
  }
  summary.push({ name: cs.name, a, b, bh });
}

console.log('\nSummary (frame area, lower is better; B vs A):');
for (const s of summary) {
  const area = r => (r ? r.frame.w * r.frame.h : NaN);
  const best = s.bh && area(s.bh) < area(s.b) ? s.bh : s.b;
  const pct = ((area(best) / area(s.a) - 1) * 100);
  console.log(`  ${s.name.padEnd(54)} A ${(area(s.a) / 100).toFixed(0).padStart(6)} cm2   B ${(area(best) / 100).toFixed(0).padStart(6)} cm2   ${pct >= 0 ? '+' : ''}${pct.toFixed(1)}%`);
}
