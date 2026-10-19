# Plotter Studio — Dashboard plugin

Version 0.4.0. A fork of the **SVG to G-code** plugin (0.7.2) aimed at pen plotting. The original `svg-to-gcode` plugin is unchanged and still installs separately; this one has its own id (`plotter-studio`), its own saved presets, and is where new plotter features go. Everything the original does (SVG and 2D DXF import, drag knife, laser, ordering, endpoint joining, presets, Save As) still works the same way; see `../svg-to-gcode/README.md` for those details.

It generates millimeter, absolute-coordinate G-code for inspection in the UGS Dashboard. It never sends machine commands or starts a job.

## What is new: color to pen

Every imported path now carries a color.

- **SVG:** the stroke color, else the fill color. Both are inherited from parent groups, as in SVG itself. Hex (`#f00`, `#ff0000`), `rgb()` and the common named colors are understood. Gradients, patterns, `currentColor` and CSS classes cannot be resolved and plot as black.
- **DXF:** the entity's true color, else its explicit AutoCAD color index, else its layer's color. Color 7 (white/black in CAD) plots black.
- **Endpoint joining** (Quality tab) and DXF line/arc joining never join paths of different colors.

The new **Pens** tab lists every color with its path count and a **Pen** number:

- Each color starts on its own pen, numbered in order of appearance.
- Type the same number for several colors to put them on one pen. Several shades of red can share a pen.
- **0 skips** a color entirely (it is not plotted).
- **One pen per color** and **All on pen 1** reset the table. Assignments survive a Reimport for colors that still exist.
- Pens apply in **plotter mode** only. Knife and laser modes ignore the table.
- The preview draws plotter paths in their color.

Pens are plotted in number order, and a pen is finished before the next starts. Path ordering (Reduce travel, Inner contours first, Largest closed contour last) and start points apply within each pen. Inner-first never waits on a path of another pen.

## Pen changes

**When the pen changes** (Pens tab):

| Option | Output |
| --- | --- |
| Pause (M0) | Before every pen group, including the first: lift to Safe Z, a `(Pen N (colors))` comment, then `M0`. Resume in UGS after swapping. |
| Tool change | Lift to Safe Z, the comment, then `T<n> M6`, using the pen number. Check that your controller accepts `M6`. |
| Separate file per pen | One complete program per pen. After Generate, choose the pen under **Pen file**; Save As and Copy use the file shown. Repeat for each pen. |
| No pause | A single program sorted by pen, with comments but no stop. |

Pen changes only add commands when there is more than one pen. After a manual swap, re-establish the same Z reference for every pen; the plugin cannot know pen lengths.

## Fills (0.2.0; wavy and zigzag 0.3.0; wavy cross-hatch and hidden-line removal 0.4.0)

Closed shapes can be filled with parallel pen lines. Open the **Pens** tab, **Fills** table (plotter mode only).

- **Which shapes:** only shapes that have a fill in the artwork. An unspecified fill counts as none (SVG would paint it black, but for plotting that is almost never wanted). Tick **Hatch every closed shape** to override this; those shapes are hatched in their stroke color. DXF has no fills, so DXF needs the override.
- **Which pen:** the pen assigned to the shape's *fill* color. A shape with a blue stroke and a red fill is outlined by the blue pen and hatched by the red pen. Fill colors appear in the color table (shown as "N fills").
- **Per-pen settings:** each pen in the **Fills** table has a one-line summary, an **Edit** button and a **Random** button. Edit opens a popup with:
  - **Pattern:** None, **Parallel lines**, **Cross-hatch** (a second set at +90 degrees), **Wavy lines** or **Wavy cross-hatch** (two wavy sets, 90 degrees apart).
  - **Angle** (degrees, measured in output coordinates after the rotation setting), **Line spacing** (mm) and **Gap from outline** (mm).
  - **Wavy patterns only:** **Wave height** (how far a line swings to each side), **Wavelength**, and **Wave shift between lines** (0 keeps neighboring waves parallel, 180 swings them in opposite directions). The gap is kept at the peaks too, so the outline clearance never shrinks.
  - **Zigzag:** join the ends of neighboring lines so the pen stays down. A connector is only added when it is short (about two line spacings), stays inside the shape and keeps clear of the outline, so it never cuts across a hole or a notch; where it would, the pen lifts as usual. Works for straight and wavy lines.
  - **Random:** picks a pattern, angle, spacing, gap and wave settings at random for that pen. **Random fills** (above the table) does it for every pen. Click again for a new roll; Edit afterward to fine-tune.
- **Gap:** every line stops at least this far from every outline, including holes, so hatching never touches the stroke. Set 0 to run lines right up to the outline. Pieces shorter than 0.1 mm are dropped.
- **Grid and direction:** lines sit on a fixed grid so touching shapes line up, and alternate direction line to line to shorten pen travel (zigzag removes the lifts altogether).
- **Holes:** all subpaths of one SVG element are filled together with the even-odd rule, so a compound path such as a ring or a letter "O" keeps its hole. Separate elements are filled independently, with no hole logic between them.
- **Order:** within a pen, hatch is plotted after the outlines; **Hatch before outlines** flips that. **Don't outline shapes that have a fill but no stroke** drops the outline of such shapes and keeps the hatch.
- **Background:** the color picker above the preview (with an **Auto** reset) changes only the preview background, so black pens stay visible; it is remembered between sessions and never affects the G-code.
- **Preview:** hatch lines are drawn thin and without start/end markers, and are not listed under Selected path. Path numbers and the G-code include them.
- **Limits:** 20,000 lines per angle per shape and 100,000 in total; the plugin asks you to increase the spacing beyond that.

**Hidden-line removal** (checkbox **Hide lines covered by shapes above**, off by default, plotter mode only): SVG paints later elements over earlier ones, and a plotter cannot cover a line, so this option removes what a shape below would have drawn where a shape above hides it.
- **Which shapes hide things:** closed shapes that have a fill (explicitly, not through the "Hatch every closed shape" override). A shape with no fill hides nothing, as in the SVG itself. Fill opacity is ignored: any fill hides completely.
- **What is hidden:** the outlines and the hatch of every element *earlier* in the file, inside the covering shape's area (even-odd, so a ring's hole stays visible). It applies whatever pen is assigned; a shape set to Skip still covers what is below it.
- **Result:** a partly covered outline becomes open pieces (a closed outline whose seam is visible stays one piece); a fully covered path disappears. Pieces shorter than 0.05 mm are dropped. The message area reports how many paths were trimmed and removed. Manual start or direction picks on a trimmed outline are lost, because it becomes new paths.
- **Limits:** SVG only (a DXF has no stacking order or fills); the covering is computed on the sampled outline, so curves are approximated at the sampling tolerance; there is no margin, so lines run right up to the covering shape's edge. A very large drawing stops with a "too large" message rather than hanging.
With it off, overlapping filled shapes are each drawn in full and the plugin reports how many pairs overlap.

Other limits: no nonzero fill rule, no fills in knife or laser mode, and fill settings are not saved in presets (the global checkboxes are). Automatic clustering of colors into a chosen number of pens is not implemented yet.

## Install

Copy these files into `~/.ugs/dashboard-plugins/plotter-studio/` on the computer running UGS:

`plugin.json`, `index.html`, `style.css`, `app.js`, `dropdowns.js`, `core.js`, `importer.js`, `geometry.js`, `dxf-importer.js`

Then reload Dashboard and choose **Plotter Studio** under Plugins. No Platform rebuild or UGS restart is needed. `sample.svg`, `sample-colors.svg` (five colors) and `sample-fills.svg` (a ring with a hole and a triangle, both filled) and `sample-overlap.svg` (three overlapping filled shapes, for hidden-line removal) are included for testing.

## Development and validation

No dependencies or build step. Run `node pens.test.cjs` (pen grouping, M0/M6/files output, skip, shared pens, DXF color), `node fill.test.cjs` (hatch geometry, gap, holes, ordering), plus `core.test.cjs`, `knife.test.cjs`, `dxf.test.cjs`, `geometry.test.cjs` and `cleanup.test.cjs`. `preview-host.html` runs the plugin sandboxed and simulates the Save As bridge without writing a file or contacting a controller.

Not validated: a physical multi-pen plot, M6 on a real controller, and the real Dashboard Save As dialog for this plugin.
