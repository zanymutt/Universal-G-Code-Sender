# Plotter Studio — Dashboard plugin

Version 0.1.0. A fork of the **SVG to G-code** plugin (0.7.2) aimed at pen plotting. The original `svg-to-gcode` plugin is unchanged and still installs separately; this one has its own id (`plotter-studio`), its own saved presets, and is where new plotter features go. Everything the original does (SVG and 2D DXF import, drag knife, laser, ordering, endpoint joining, presets, Save As) still works the same way; see `../svg-to-gcode/README.md` for those details.

It generates millimeter, absolute-coordinate G-code for inspection in the UGS Dashboard. It never sends machine commands or starts a job.

## What is new: colour to pen

Every imported path now carries a colour.

- **SVG:** the stroke colour, else the fill colour. Both are inherited from parent groups, as in SVG itself. Hex (`#f00`, `#ff0000`), `rgb()` and the common named colours are understood. Gradients, patterns, `currentColor` and CSS classes cannot be resolved and plot as black.
- **DXF:** the entity's true colour, else its explicit AutoCAD colour index, else its layer's colour. Colour 7 (white/black in CAD) plots black.
- **Endpoint joining** (Quality tab) and DXF line/arc joining never join paths of different colours.

The new **Pens** tab lists every colour with its path count and a **Pen** number:

- Each colour starts on its own pen, numbered in order of appearance.
- Type the same number for several colours to put them on one pen. Several shades of red can share a pen.
- **0 skips** a colour entirely (it is not plotted).
- **One pen per colour** and **All on pen 1** reset the table. Assignments survive a Reimport for colours that still exist.
- Pens apply in **plotter mode** only. Knife and laser modes ignore the table.
- The preview draws plotter paths in their colour.

Pens are plotted in number order, and a pen is finished before the next starts. Path ordering (Reduce travel, Inner contours first, Largest closed contour last) and start points apply within each pen. Inner-first never waits on a path of another pen.

## Pen changes

**When the pen changes** (Pens tab):

| Option | Output |
| --- | --- |
| Pause (M0) | Before every pen group, including the first: lift to Safe Z, a `(Pen N (colours))` comment, then `M0`. Resume in UGS after swapping. |
| Tool change | Lift to Safe Z, the comment, then `T<n> M6`, using the pen number. Check that your controller accepts `M6`. |
| Separate file per pen | One complete program per pen. After Generate, choose the pen under **Pen file**; Save As and Copy use the file shown. Repeat for each pen. |
| No pause | A single program sorted by pen, with comments but no stop. |

Pen changes only add commands when there is more than one pen. After a manual swap, re-establish the same Z reference for every pen; the plugin cannot know pen lengths.

## Planned

Fills (straight hatch at an angle, cross-hatch, wavy lines) per pen, and automatic clustering of colours into a chosen number of pens, are not implemented yet.

## Install

Copy these files into `~/.ugs/dashboard-plugins/plotter-studio/` on the computer running UGS:

`plugin.json`, `index.html`, `style.css`, `app.js`, `dropdowns.js`, `core.js`, `importer.js`, `geometry.js`, `dxf-importer.js`

Then reload Dashboard and choose **Plotter Studio** under Plugins. No Platform rebuild or UGS restart is needed. `sample.svg` and `sample-colors.svg` (five colours) are included for testing.

## Development and validation

No dependencies or build step. Run `node pens.test.cjs` (pen grouping, M0/M6/files output, skip, shared pens, DXF colour), plus `core.test.cjs`, `knife.test.cjs`, `dxf.test.cjs`, `geometry.test.cjs` and `cleanup.test.cjs`. `preview-host.html` runs the plugin sandboxed and simulates the Save As bridge without writing a file or contacting a controller.

Not validated: a physical multi-pen plot, M6 on a real controller, and the real Dashboard Save As dialog for this plugin.
