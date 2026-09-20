# Nesting — Dashboard plugin

Packs copies of one G-code part onto a sheet using the part's **outer shape**, so shapes can interlock (a triangle beside an inverted triangle). It writes a new program with every copy rotated and moved into place. It never sends machine commands or starts a job.

Version 0.2.2. Written for plasma-style programs (probe, pierce, cut, retract) but it only depends on the file structure described below.

## Install

Copy these files into `~/.ugs/dashboard-plugins/nesting/` on the computer running UGS, reload Dashboard, and choose **Nesting** under Plugins. No Platform rebuild is needed.

- `plugin.json`, `index.html`, `style.css`, `app.js`, `dropdowns.js`, `core.js`
- `sample.gcode` is optional: the example is built into `app.js` (the sandboxed plugin cannot fetch its own files), and a test keeps the two identical

## Workflow

1. **Part** source: **Use file open in Dashboard**, or **G-code file** to pick one from this device. It works with nothing open in Dashboard. If a file is open when the plugin starts it is loaded automatically.
2. **Layout** tab: choose a mode, counts/sizes, gap and search effort, then **Nest & generate**.
3. Check the preview, the summary line and the smallest achieved gap.
4. **Output** tab: origin, cut sequence, walk between cuts, comments, rapid rate for the time estimate. These re-generate instantly, no re-nesting.
5. **Save As into Dashboard** (uses the Dashboard's own dialog) or **Copy G-code**.

Layout modes:

| Mode | You give | You get |
|---|---|---|
| Fixed width X | N parts, **maximum** X | minimum Y |
| Fixed height Y | N parts, **maximum** Y | minimum X |
| N parts → minimum area | N parts, optional X/Y limits | smallest bounding rectangle (unlimited, this is often one long narrow strip; use a limit) |
| Sheet X × Y → maximum parts | sheet size | as many as fit (tries both directions) |

Every size you enter is a **limit**. The frame (and the origin corners) is the tight bounding box of what was actually placed, so it can be smaller than the limit; only maximum-parts mode keeps your sheet as the frame.

Settings: rotation on/off and step (15° = 24 orientations; parts are never mirrored), minimum gap, result preference, effort (1/3/5 scoring passes, best result kept).

**Result preference.** *Compact block* (default) keeps the smallest frame area among results within 3% of the shortest length; *Shortest length* is strict. The two can differ because the shortest layouts sometimes stagger columns so the lead-in tips of one column tuck into gaps of the next, saving a few mm of length but leaving visible gaps and a bigger frame. Origin: bottom-left/right, top-left/right, nest center or custom (typed or picked in the preview), measured on the nest frame — the fixed width/height you entered or the sheet, with the free side taken from the result. There is no stock margin; put that in the origin.

## Cut order (inner cuts first)

A program with several cutting cycles is split into **cut blocks**. Plasma/laser files mark a cycle with M3/M4 … M5 (each with its own approach, probe, pierce, cut and retract). Pen, drag-knife and plotter files have no such commands, so a cycle there is a run of cutting moves that ends when the tool lifts (a Z-only rapid) to the **highest Z the program uses**; lifts to a lower Z, such as a drag knife's corner swivels, do not split a cut. A figure label comment (e.g. GRBL-Plotter's `(<Figure …>)`) travels with its cut. A block is an **inner cut** when its contour lies inside another contour (a hole), otherwise **outer**. Fusion already emits holes first for one part; across many parts the default "Inner cuts of every part first, then outer cuts" makes all holes before any part is cut free, so the sheet stays rigid. "One part at a time" keeps each part complete in file order instead. Either way, "Walk between cuts" chooses nearest-next (default) or part-number order.

Each block is copied whole, so every probe, pierce delay, pause and retract stays exactly as in the file. Only modal words the block inherited from its old neighbour are restated when the order changes (motion word on a bare XY line, an inherited F, G90/G91, plane). If the first cut of the program is not the file's original first cut, the file's own start-height lift (e.g. `G0 Z30`) is inserted first, because only the original first block lifts before moving.

A file that cannot be split safely (tool changes, work-offset changes, a cut with no XY approach before its probe) stays one block in file order and shows a warning.

**Drag knife / vinyl:** the file's path is the holder path, so it is rotated and moved as a rigid shape and the file's own lead-ins and overcut ("extend path") are kept (and counted as part of the outline when packing). The blade's orientation on entering each cut depends on the previous travel, exactly as in the original file; reordering does not change how each cut is built, but check that your cuts begin with enough lead-in for the blade to swivel. Multi-pass files that lift to the top Z between passes of the same path are split per pass; the default nearest-next walk keeps a path's passes together and in order.

## How the file is treated

The whole file is **one part**. It is split into:

- **header** — everything before the first X/Y move (modal setup such as `G90 G21 G54`). Written once.
- **body** — from the first X/Y move to the last cut and its retract (approach, height probe, pierce, cut, `M5`, dwell, lift). Repeated for every copy; made of one or more cut blocks (see above).
- **footer** — from the first X/Y move or `M2`/`M30` after the last cut (park move, program end). Written once, so `G0 X0 Y0` and `M30` appear a single time at the end.

Inside each copy only the X/Y words of plain `G0`–`G3` moves, and arc `I`/`J`, are rotated and translated (arcs stay arcs). Everything else is copied verbatim: probe macros, `#` variables and `o` blocks, `G10`/`G53`/`G92` lines, M-codes, dwells, feeds and comments. Lines containing expressions or machine-coordinate words are never touched. Modal single-axis lines (`Y20`) and `G91` relative moves are handled. G20 inch files are packed in mm and written back in inches.

The probe macro therefore runs once per copy, and so does any end-of-operation dwell your post emits (the sample Fusion file has a 13 s `G4` after each cut).

## Packing

The outer contour(s) of the cutting path — contours not inside another — form the shape, **including lead-in/lead-out**, because a pierce landing on a neighbour would ruin it. Inner cuts do not matter for packing. Each orientation is reduced to a per-column vertical extent and grown by half the gap on each side; every placed part records the interval it occupies in each x-column, so later parts can slide under an overhang or into a pocket. Placement is bottom-left with tolerance-based tie-breaking, run with several scoring variants (the effort setting). After placing, a **compaction** pass takes each part out and lets it fall toward the origin corner as far as the others allow, so nothing is left hanging where it first landed. When rotation is on, the quarter-turn-only subset is also tried, so a finer step is never worse than a coarser one.

- The **gap is edge to edge** between outer shapes. Kerf is not added; account for it in your post.
- After packing, an exact polygon check measures the real smallest gap and confirms nothing overlaps or leaves the frame. The result message reports it; a failed check is flagged as an error.
- The achieved gap is usually a little larger than requested (grid rounding, lead-in spikes).
- Limits: a part is packed by the per-column top and bottom of its outline. A deep C-shaped pocket that opens sideways cannot hold another part. Parts do not nest inside another part's holes.

## Estimate

Cutting time uses each move's `F` word, rapids use the rate you enter, and `G4` dwells are added. Z moves, probing and acceleration are not counted, so it is a lower bound.

## Not implemented yet

- Lead-in/lead-out generation and tabs/bridges (the part's own path is kept as is).
- Common-line cutting.
- Reading files from the Dashboard workspace inside the plugin (`readFile` is not in the bridge); use the open file or a device file.

## Development and validation

No dependencies or build step. `core.js` is DOM-free (parser, packer, transform, analysis); `app.js` is the UI and the minimal host message bridge; `dropdowns.js` is the shared bounded-menu helper from svg-to-gcode.

`node core.test.cjs` runs the checks: header/body/footer split, cut-block detection (torch cycles and pen-up/down cycles, corner lifts not split) and inner-first sequencing (every pause, probe and pierce preserved, output re-parsed), verbatim pass-through of probe/expression/footer lines, arc/G91/single-axis rotation, inch files, triangle interlock and alternating rows, all four modes, exact no-overlap/gap checks on random shapes, and a full round trip (nested output re-parsed and re-measured). If `NEST_SAMPLE` / `NEST_SAMPLE_RAM` / `NEST_SAMPLE_KNIFE` point to G-code files (or the author's local heart, ram-mount and knife files exist) real-file checks also run.

`preview-host.html` runs the plugin in `sandbox="allow-scripts"` with a simulated bridge (`?empty` simulates no open file). Serve this folder over HTTP to use it.

Validated: the checks above, the plugin UI in a desktop-width and phone-width browser (load, all four modes, origin changes, preview, cut numbering), and, by the author in the real Dashboard, loading the open file, loading a device file and Save As. **Not validated:** any physical cut, and reordered (inner-first) programs on a machine. Cut a scrap sheet first, and confirm the origin and Z reference before running a nested file.
