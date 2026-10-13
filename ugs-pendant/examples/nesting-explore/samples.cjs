// Synthetic plasma-style programs for the benchmark and for hand testing. Same structure as the
// Nesting plugin's sample: setup, torch height probe, pierce, cut, retract, end. Each contour is its
// own torch cycle; list holes before the outline, as Fusion does.
'use strict';

const HEAD = ['(Synthetic sample for Nesting Explore)', 'G90 G94 G17', 'G21', 'G54'];
const FOOT = ['M5', 'G0 X0 Y0', 'M30'];

function program(contours) {
  const out = [...HEAD];
  contours.forEach((poly, i) => {
    const [x0, y0] = poly[0];
    out.push(`G0 X${x0.toFixed(3)} Y${y0.toFixed(3)} F2500`, `G0 X${x0.toFixed(3)} Y${y0.toFixed(3)} Z25`, 'G53 G38.2 Z0 F200',
      '#100 = -3 ; default assume float switch trigger', 'G10 L20 Z[#100]', 'Z3', 'M4 S1000', 'G4 P0.4', 'G1 Z2.5 F2500');
    for (let k = 1; k < poly.length; k++) out.push(`G1 X${poly[k][0].toFixed(3)} Y${poly[k][1].toFixed(3)}`);
    out.push(`G1 X${x0.toFixed(3)} Y${y0.toFixed(3)}`, 'M5', 'G4 P0.5', 'G0 Z30');
  });
  out.push(...FOOT);
  return out.join('\n') + '\n';
}

const circle = (cx, cy, r, n = 48) => Array.from({ length: n }, (_, i) => [cx + r * Math.cos(2 * Math.PI * i / n), cy + r * Math.sin(2 * Math.PI * i / n)]);
const rect = (x, y, w, h) => [[x, y], [x + w, y], [x + w, y + h], [x, y + h]];

const shapes = {
  rightTriangle: () => program([[[0, 0], [80, 0], [0, 50]]]),
  // The "flattened triangle with curves" family (avakey): wide, low, one pointed end.
  wedge: () => program([[[0, 0], [120, 8], [120, 30], [0, 22]]]),
  lShape: () => program([[[0, 0], [80, 0], [80, 30], [30, 30], [30, 80], [0, 80]]]),
  // C opening to the right: a part that can only be filled by a neighbour with a column of runs.
  cShape: () => program([[[0, 0], [80, 0], [80, 25], [30, 25], [30, 55], [80, 55], [80, 80], [0, 80]]]),
  uShape: () => program([[[0, 0], [90, 0], [90, 60], [65, 60], [65, 25], [25, 25], [25, 60], [0, 60]]]),
  trapezoid: () => program([[[0, 0], [100, 0], [80, 40], [20, 40]]]),
  disc: r => program([circle(0, 0, r)]),
  // Plate with a round hole: the hole is cut first, then the outline.
  washer: (size = 100, hole = 64) => program([circle(size / 2, size / 2, hole / 2, 64), rect(0, 0, size, size)]),
  // Frame with a large rectangular window.
  frame: () => program([rect(30, 30, 100, 60).reverse(), rect(0, 0, 160, 120)]),
};

module.exports = { program, circle, rect, shapes };

if (require.main === module) {
  const fs = require('node:fs');
  const path = require('node:path');
  const dir = path.join(__dirname, 'samples');
  fs.mkdirSync(dir, { recursive: true });
  const files = {
    'holes-washer-100.gcode': shapes.washer(100, 64),
    'holes-disc-20.gcode': shapes.disc(10),
    'holes-disc-30.gcode': shapes.disc(15),
    'holes-frame.gcode': shapes.frame(),
    'wedge.gcode': shapes.wedge(),
    'l-shape.gcode': shapes.lShape(),
    'c-shape.gcode': shapes.cShape(),
    'u-shape.gcode': shapes.uShape(),
    'trapezoid.gcode': shapes.trapezoid(),
    'right-triangle.gcode': shapes.rightTriangle(),
  };
  for (const [name, text] of Object.entries(files)) fs.writeFileSync(path.join(dir, name), text);
  console.log(`wrote ${Object.keys(files).length} samples to ${dir}`);
}
