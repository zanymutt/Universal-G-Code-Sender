# Nesting Explore — Dashboard plugin (experiment)

A side-by-side test bed for a new nesting engine. It starts from the shipping **Nesting** plugin
(`../nesting`) and runs two packers on the same parts:

- **Engine A** — `core.js`, the current Nesting engine. Byte-for-byte the Nesting plugin's code, plus one
  additive hook (`opts.reorder`, unused by A) so B can reorder cuts.
- **Engine B** — `engine-b.js`, the experiment. It reuses A's parsing, G-code generation, origin handling
  and cut-order planner unchanged; only *where each copy goes* is new.

Everything else (Files / Part / Layout / Output tabs, origin picking, Save As, presets) is the Nesting
plugin's UI. Both layouts land in a comparison table; click a row to show that layout in the preview and
G-code. The origin stays changeable and compact nests are still built outward from the chosen corner.

## What Engine B changes

| Idea | Why |
|---|---|
| **Column runs instead of one extent per column.** A footprint keeps every vertical run of material per x-column (even-odd inside a part, union across parts). | A's single `[lowest, highest]` pair fills notches, so a disc can never sit in a C or an L. |
| **Parts in holes (toggle).** Holes big enough for the smallest file become free space. The nested part is cut before the hole around it; the host outline is cut after its hole. | Recovers slug material. Off by default. |
| **Edge-aligned angles (toggle).** On top of the step grid, the angles that lay each long convex-hull edge against a sheet side. | A part with a 37° edge is best at 37°, not at the nearest multiple of 15°. Also makes a 90° step no worse than 15°. |
| **Mirror instead of corner flags.** For a top or right origin the geometry is mirrored, solved bottom-left, and mirrored back. | The packer has no corner special cases; the real parts are unmirrored in the output. |
| **Footprint memo + exact edge extents.** Positions are cached until a part is added in their columns. | Several times faster per construction, so time goes to search. |
| **Repeating-pattern seeds (toggle, on).** With six or more copies of a part, the densest row lattice (the part, or the part plus its half-turn twin) is tiled into the strip, then the rest is filled greedily. `lattice-probe.cjs` measures the bound. | Repeated parts pack in a pattern; greedy placement drifts out of phase between rows. Gained 7% on triangles and 4% on the avakey at 100 copies; nothing on the trapezoid, where the strip width does not divide the pattern. |
| **Time-budgeted improvement.** After the constructions, a loop lowers the length limit slightly, lifts out the parts that stick out plus a few neighbours, re-inserts them, and keeps it when all fit. It restarts from other constructions until nothing improves. | Greedy packing is chaotic; this turns spare seconds into area. |

The plain step grid and the quarter turns are always constructed too, so a larger orientation set cannot
lose to a smaller one by luck. The footprint also includes the cut path itself (lead-ins are zero-width
spikes), exactly as A does.

Search time: **Quick** ≈ 12 s, **Medium** ≈ 45 s, **Long** ≈ 100 s. The search stops earlier when several
fresh starts in a row bring nothing (3 / 8 / 16 starts).

## Run it

Install like Nesting: copy `plugin.json`, `index.html`, `style.css`, `app.js`, `dropdowns.js`,
`core.js` and `engine-b.js` into `~/.ugs/dashboard-plugins/nesting-explore/`, reload Dashboard, and choose
**Nesting Explore** under Plugins. `Engine: Compare A and B` runs both and shows B first.

## Benchmark and tests

```
node bench.cjs                      # all cases, B at tier quick
node bench.cjs --tier=long          # quick | medium | long
node bench.cjs --only=heart,holes   # name filter
node samples.cjs                    # (re)write samples/*.gcode, including the parts-in-holes files
node engine-b.test.cjs              # Engine B checks
node lattice-probe.cjs              # densest repeating pattern per part (what lattice seeding aims at)
```

`bench.cjs` reads the real parts from the `\\MAIN-PC` share (skipped when unreachable) and generates the
synthetic ones. `samples/` holds synthetic parts only; no private part files are kept in the repository.

Parts-in-holes samples: `samples/holes-washer-100.gcode` (100 mm plate, 64 mm hole),
`samples/holes-frame.gcode` (160 × 120 frame with a 100 × 60 window), and discs
`holes-disc-20.gcode` / `holes-disc-30.gcode`. Add the plate and some discs, turn on *Allow parts inside
other parts' holes*, and use a narrow maximum X so the discs have to go in the holes.

## Known limits

- Greedy plus local search, not an exact optimiser. Mixed jobs with a free width and a Y limit are
  about a tie with A; the clear wins are repeated parts, concave parts and holes.
- A hole smaller than the smallest file's outline is left as material (it cannot hold any copy).
- The cut-order fix for nested parts changes the *order* only; a slug can still drop through a slat table
  once it is cut loose, so keep parts in holes for parts you trust.
- `utilization` counts the outline area in A and net material (outline minus holes) in B when holes are on.
