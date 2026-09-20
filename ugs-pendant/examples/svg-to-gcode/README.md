# SVG to G-code — Dashboard plugin

Version 0.6.0 includes passive drag-knife compensation and is a working release for Z-lift plotters, drag knives, and vector lasers. It generates millimeter, absolute-coordinate G-code for inspection in UGS Dashboard. It never sends machine commands or starts a job.

## Bounded nearby-node merging (0.6.0)

Quality now includes **Merge nearby nodes (mm; 0 = off)**, default 0.001 mm, saved in presets. Older presets without the field use 0.001 mm. Changing it requires Reimport, like the other import controls. Original SVG files and saved settings.json are not modified by installation.

Before short-move cleanup and knife compensation, consecutive sampled vertices on the same contour are grouped only while the entire group's bounding-box diagonal stays within the merge distance. This conservative bound prevents a chain of short steps from collapsing a long curve. It also means not every neighboring pair is necessarily merged across group boundaries. The representative retains the group's incoming and outgoing directions, preserving the net corner instead of making swivels around each microscopic intermediate edge. Open endpoints are retained exactly, closed seams keep their starting position, closed contours keep at least three vertices, and distinct contours are never joined. Distances apply in physical SVG millimeters before scale; 0.01 mm deliberately removes larger tiny details than the 0.001 mm default.

With the supplied Kena SVG and the user's 0.1 mm sampling/cleanup settings, the 0.001 mm merge pass consolidates 51 vertices and removes the top-left A node-pair's two artificial swivels; the neighboring real corner remains. Tests cover merging off/on, preserved net corners, bounded chains, endpoints, small closed shapes, closed seams, separate paths, worker/fallback equality, progress/cancellation and preset round trips. No physical machine operation was performed.

## Tiny opposing-turn cleanup (0.5.1)

Short-move cleanup now recognizes an interior pair of opposing turns joined by a step no longer than both the short-move threshold and the allowed cleanup deviation (half the curve/cleanup tolerance). The surrounding contour directions must match within 1 degree, the two turn signs must oppose, and the existing positional-deviation checks must pass for every removed sample. Cleanup restores the retained incoming direction so a deleted step cannot leave a false swivel behind. It does not join separate paths or alter the original SVG.

On the supplied Kena SVG with 0.1 mm short-move threshold and 0.01 mm curve tolerance, the 0.000522 mm step at the bottom between N and A no longer causes two approximately 94-degree swivels or their Z lifts. Cleanup off preserves the original geometry. Tests also retain steps above tolerance, mismatched surrounding headings, real corners and path endpoints. Worker and synchronous output remain identical. Saved presets are unchanged.

## Fast import, progress and corrected corners (0.5.0)

SVG geometry is evaluated directly by geometry.js: lines, quadratic/cubic Beziers (including reflected S/T controls), elliptical arcs, and their one-sided derivatives. There are no browser getPointAtLength/getTotalLength calls. Adaptive sampling preserves command junctions, splits at derivative roots and bounds changes of direction as well as positional deviation. Short-move cleanup retains rapid smooth direction changes and repairs tangent metadata when deleting a tiny redundant reversal. There is no longer a hard-coded 3-degree curve-junction smoothing rule.

Heavy geometry processing runs in a cancellable Blob worker. The plugin displays a status banner, animated spinner, path progress and Cancel button while reading and importing, then clears it on success, failure or cancellation. A new import supersedes an old one without allowing stale results to replace the preview. Where browser policy blocks workers, the same geometry generator runs in short chunks and yields to the UI. XML parsing/validation and preview rendering still run on the UI thread; the 5 MB input, 500 path and 100,000 sampled-point limits remain. Generate reuses the valid preview plan instead of repeating it.

The two knife angle controls are independent:

- **Swivel arc angle**, default **10 degrees**: insert an arc when the corner direction change exceeds this value. Below it, connect the two offset positions directly. Zero inserts arcs at every nonzero discrete corner; 180 disables internal corner arcs. Entry alignment is controlled separately. Smooth continuous curves are not given a pivot at every sample.
- **Swivel lift angle**: the previous angle setting, preserved in existing presets. For an inserted arc, a turn at or above this angle lifts to swivel Z if the lift switch is enabled. All inserted swivel arcs use swivel feed. The lift threshold alone does not create an arc.

Explicit swivel arcs use at most 5-degree steps and a 0.001 mm chord-deviation bound, further limited by the selected maximum step. Output simplification never removes their points. Tight continuous turns (local sampled radius below blade offset) also bypass output simplification and appear solid orange; they continue at working feed/cut Z because they are continuous curves rather than inserted stationary-tip swivels. Ordinary holder cutting movements remain dashed blue. This distinction matters for artwork with extremely small rounded corners, such as the supplied A.

All presets save the new arc angle independently of the lift angle. Older presets default the new arc angle to 10 degrees without altering their saved lift angle, offset, Z or feed values. The settings.json file is preserved during installation.

Measured in an embedded Edge test on the supplied A: direct import about 5–9 ms; complete background import about 14 ms, versus about 2.15 seconds previously. Browser geometry queries fell from 16,114 to zero. A larger background test left UI timer callbacks running and passed progress/cancellation tests. Timings vary by computer and artwork.

Corner correctness takes priority over the earlier minimum line count. Using the supplied Kena v2 SVG and saved RolandDrag2 tool settings with default quality settings produced 1,780 lines / 38,226 bytes, including restored tight turns and finer explicit swivels; the older pre-optimization export had 4,694 lines. The 0.4.0 figure below is historical and omitted/missampled some tight turns.

Validation: 13 planner checks, 15 knife checks, 8 direct-geometry/corner checks, existing importer/browser regressions, 0.45 and 3 mm offsets in both directions, progressive passes, independent arc/lift threshold behavior, protected arcs at high output simplification, worker/fallback equivalence, responsive background import, cancellation, stale-result suppression, solid turn overlays, presets and simulated Save As. No physical cutting or machine commands were performed. The older release notes below describe their respective versions and are superseded by this section.

## Quality controls and smoother output (0.4.0)

Settings are grouped into Artwork, Tool, Paths, Quality and Presets tabs. Tabs support arrow keys and Home/End. Presets include all quality settings, tool mode and blade offset. Loading an older preset retains its saved spacing/cleanup and defaults endpoint equality to 0 (preserve old openings); new controls otherwise use the defaults below.

- **Minimum segments per curve/spline: 12.** Applied per SVG C/S/Q/T command; more samples are added for maximum step and adaptive curve tolerance. Higher counts sample more finely, although output simplification can merge redundant samples. Straight lines retain their endpoints without unnecessary subdivision.
- **Maximum arc/curve step: 0.5 mm.** Sampling distance along curved artwork, also limiting knife swivel chords. Smaller means more samples. Similar to GRBL-Plotter's circumference step, but this control also bounds spline sample spacing. All output remains G1; no G2/G3 fitting is performed.
- **Curve/cleanup tolerance: 0.01 mm.** Adaptive curve sampling checks quarter/mid/three-quarter positions against half this tolerance; short-move cleanup uses the other half. This is an approximation control, not a formal global error guarantee. Import distances are before artwork scaling.
- **Remove short moves below: 0.1 mm (0 disables).** Removes only nearby redundant samples whose replacement stays within the cleanup allowance. Meaningful small features and endpoints can remain.
- **Endpoint equality: 0.01 mm (0 disables).** Closes only the start/end gap of the same subpath when within tolerance. Never merges different subpaths, and does not infer closure from fill or intersections. Closing changes contour ordering/overlap eligibility; use 0 for intentionally open tiny gaps.
- **Output simplification: 0.01 mm (0 disables).** After scaling, removes redundant points within the selected deviation from the sampled trajectory. Plotter/laser use the cut path; knife uses the holder path. Knife swivel, entry, feed/Z boundaries and path starts/ends are retained. This is not a guaranteed blade-tip error. The preview shows the sampled intended cut and the actual simplified knife-holder trajectory.

Reimport applies import controls and resets manual starts/directions. Output tolerance applies immediately. Original SVG files are never modified. Repeated F words are omitted in all modes; feeds still change at every required transition.

Smooth SVG samples now carry curve tangents through scaling, rotation, path reversal, manual start selection and compensation. The holder follows one smooth offset trajectory instead of alternating a short cut and pivot at every sample. Discontinuous corner tangents retain explicit swivels, with the existing angle threshold controlling feed/Z lift. Nearly matching curve-junction tangents (under 3 degrees) are averaged to suppress numerical sampling noise; straight-line junctions retain their corners. This remains approximate passive-knife geometry; actual tip response depends on blade contact and orientation.

On the supplied Kena v2 SVG with the saved RolandDrag2 tool settings and new quality defaults, output is 978 lines / 21,076 bytes, versus 4,698 lines reconstructed with the previous plugin (the supplied older export has 4,694). The SVG/start settings are not an exact reconstruction of that older export. Moves below 0.05 mm drop from 2,708 in the supplied export to 17 in the new result; repeated feed words drop to zero. Feed and Z settings were not reduced to obtain this result.

Validation includes planner/knife/import regressions; both 0.45 and 3 mm circle offsets; reversed circles with manual starts; ideal passive-tip numerical integration; progressive passes; quality/preset round trips; simulated Save As; and embedded-frame tab, dropdown, crosshair and origin-scroll checks. For the circle test, ideal simulated radial tip error stayed below 0.005 mm in both directions. This does not establish accuracy for all shapes or a physical machine. No physical cut or live machine command was performed.

The older release notes below describe their respective versions; the controls above supersede earlier fixed-spacing and fixed-cleanup descriptions.

## Install

Copy these files into `~/.ugs/dashboard-plugins/svg-to-gcode/` on the computer running UGS:

- `plugin.json`
- `index.html`
- `style.css`
- `app.js`
- `dropdowns.js`
- `core.js`
- `importer.js`
- `geometry.js`

Then reload Dashboard and choose **SVG to G-code** under Plugins. No Platform rebuild is required. Resize the plugin window to suit the display. The included `sample.svg` and **Load example artwork** button provide a small four-path example.

## Workflow

1. Select a local SVG file, or load the example.
2. Check the physical dimensions shown over the preview. Set scale and rotation if needed.
3. Select an origin relative to artwork bounds or the SVG page. Custom origin can be entered numerically or picked in the preview. This only offsets generated coordinates; it does not issue zeroing commands or move the machine.
4. Set the working feed, lowering feed, and safe travel Z. For plotter, set surface Z, final Z, and a positive step-down amount. For knife, use the same Surface Z, Final Z and Step down controls, plus lighter-contact Swivel Z and blade offset. Repeat each Z defaults to 1. The calculated pass count and depths update immediately. Final Z equal to surface Z produces one pass at that Z, which is useful for pen contact.
5. Choose ordering and start points. Inspect the preview: dashed travel, solid tool-down paths, numbered starts, direction arrows, cyan selected path, and red origin.
6. Generate G-code and review it. **Save As into Dashboard** uses Dashboard's existing file dialog, saves the result, and loads it for visualization. Start remains a separate Dashboard action.

Every pass on a path finishes before proceeding to the next path. Plotter example: surface 0, final -1.2, step 0.5 produces -0.5, -1.0, -1.2 on path 1, then those depths on path 2. A step larger than the total depth produces one pass. Between passes, the tool lifts to safe Z and returns to the same start, including on open paths and overlapped closed paths.

## SVG interpretation

- Physical page dimensions (mm/cm/in/pt/pc/q) and `viewBox` determine size. Pixel dimensions use 96 DPI by default; override DPI for legacy files. Inkscape raster export DPI metadata is not used to resize vector artwork.
- Paths support M/L/H/V/C/S/Q/T/A/Z, absolute and relative coordinates, and compound subpaths. Rectangles (including rounded corners), circles, ellipses, lines, polygons, and polylines are supported.
- Groups and SVG transforms are applied before sampling. Y is flipped into an upward-positive machining coordinate system. Standard `preserveAspectRatio` meet alignment and `none` are supported; `slice` is rejected.
- Curves become G1 segments. Sampling spacing is measured before the plugin's scale percentage; scaling up also increases output segment spacing. Before optional node cleanup, every SVG command endpoint is retained, including sharp corners. This is a maximum sampling interval, not a precision guarantee or arc-fitting tolerance.
- Geometry follows centerlines. Fills and stroke widths do not create offsets or pocket paths.
- Hidden layers (`display:none`) are skipped. Definitions and metadata are ignored. Convert Inkscape text and clones to paths before importing. Visible bitmap images, nested SVG viewports, clip paths, masks, filters, animation, CSS stylesheets/geometry, scripts, and foreign HTML are rejected with an explanation. Input SVG markup is never inserted into the page.
- Path numeric attributes use plain SVG user units; unit-bearing basic-shape attributes should be converted to paths. Separate SVG arc flags with spaces. External entities/DOCTYPE are rejected.
- Limits: 5 MB SVG, 500 subpaths, 100,000 sampled points, 3,000 segments per subpath, 1,000 passes, and one million ordinary output moves. Knife compensation is limited to 500,000 planned moves, including added swivels and Z transitions. Complex containment work has a bounded calculation limit and reports an error rather than silently changing order.

## Ordering and start points

**SVG order** follows SVG element/subpath order. **Reduce travel** is a nearest-next heuristic, not a guaranteed global shortest solution. It assumes travel begins at work X0 Y0; the actual initial machine location can differ.

**Inner contours first** adds containment precedence. Crossing/touching contours are not treated as holes; near-coincident/self-intersecting geometry should be checked in the preview. **Largest closed contour last** postpones the largest absolute enclosed-area path, independently of the base order. Conflicting constraints produce an error.

Automatic starts choose the nearest sampled point on closed paths. For open paths, automatic reversal is opt-in. **Pick start on path** locks a sampled start on the selected closed path, or an endpoint for an open path; manual endpoint choices can reverse the open path. Manual choices survive ordering and transform changes. Reimporting clears them. Selected path direction supports original or reversed SVG direction. Closed paths retain their start when reversed. For open paths, choosing direction clears a manual endpoint; picking an endpoint overrides direction. Path numbers follow cut order consistently in the preview, picker, and G-code. The picker lists paths in cut order as Path N � SVG name/subpath (open/closed); selection and manual edits stay attached to the same SVG contour after reordering.

Overlap applies only to closed paths, on every pass. The tool follows the beginning of the path for the requested extra distance. Overlap larger than a path's perimeter is rejected. The intended cut is shown once; knife holder overlays include every pass because entry alignment can differ.

## Tool modes

- **Plotter:** Z-lift centerline operation. Tool commands default to None, producing no M3/M4/M5/S.
- **Drag knife:** Compensated holder movement, corner swivels, explicit initial orientation, optional contact lead-ins, and progressive Z passes with optional repeats at each Z. Spindle/laser settings are disabled. Output starts with M5 and never enables the spindle or laser.
- **Optional M3/M4 (plotter/laser only):** emits the selected tool-on command with S after lowering, and M5 before lifting/travel. The S value and configured maximum are entered explicitly; the plugin does not infer the controller's range.
- **Laser:** defaults to M4, with an explicit repeat count at focus Z. M3 can be selected where appropriate. M5 is emitted before every travel/lowering sequence and after each cut. Verify the selected command and S scale match the configured laser controller. Z moves assume a machine with a Z axis; this version does not support a Z-less laser or servo-based pen lift.

Output uses G21/G90/G17/G94 and the currently selected work coordinate system. It does not home, select a work offset, set machine zero, manage coolant, apply milling cutter-radius compensation, or infer machine limits. Establish the intended Z reference before running; safe travel Z must clear the material and be above surface/focus Z, or both calibrated knife Z values. Hardware cuts have not been performed as part of software validation.

## Development and validation

No dependencies or build step. `core.js` contains geometry/order/output logic; `importer.js` uses browser SVG geometry on newly constructed path elements; `app.js` contains UI and the minimal host message bridge. Uses `saveGcodeAs`, `getSettings`, and `saveSettings`. The backend Save As endpoint now permits a new job when a workspace is configured and no file is loaded.

Run `node core.test.cjs` for planner/output checks. Serve this folder over HTTP and open `browser-tests.html` for importer checks. `preview-host.html` runs the plugin in `sandbox="allow-scripts"` and simulates the Save As response without writing a file or contacting a controller.

Validated: planner tests, browser importer tests, actual local file input, manual starts/origin, three-pass generation, laser command sequencing, and Save As postMessage handoff in the sandbox test host. The real Dashboard save dialog reuses the existing API; the sandbox test does not prove real filesystem saving. iPad/Android hardware testing and real plotter/knife tests remain to be done.

Named presets persist in UGS plugin settings across sessions. They include import, tool, transform, origin and ordering settings, but not artwork, picked starts, or individual path directions. Changing import settings through a preset reimports the current artwork and clears its path edits. Save an existing name to replace that preset. Keep your SVG and save generated jobs before closing.


## Floating-Z drag knife (0.3.1)

Enter the blade offset directly. Saved presets include tool mode, blade offset and all knife settings; there are no separate offset shortcuts.

**Knife uses Surface Z / Final Z / Step down, the same as plotter mode.** For example 0, -1.2, 0.5 produces -0.5, -1.0, -1.2. Enter values suitable for a measured spring/force table; Swivel Z starts blank. Negative Z may compress a floating setup and increase force; the program does not infer force or material penetration. When corner lifting or entry alignment is enabled, Swivel Z must be at or above the first cutting Z while still maintaining enough blade contact to turn. Equal values are permitted for a constant-force setup. Safe travel Z must fully unload and clear the blade. All progressive passes finish on one path before moving to the next. Repeat each Z repeats a level before the next step; leave it at 1 for ordinary progressive passes. Surface equal to Final produces one Z level.

**Initial orientation is an explicit assumption.** Initial travel heading is the direction in which the pivot is ahead of the tip. At the default 0 degrees (+X), manually orient the tip toward -X relative to its pivot. At 90 degrees, the tip lies toward -Y. This heading is in output/work coordinates and does not rotate automatically with the artwork. The planner carries the final heading into each next path/pass and assumes it stays stable while lifted. It cannot sense blade direction or guarantee alignment if the blade rotates in the air.

With Align blade before each pass enabled, at every pass the machine moves at safe Z to the compensated alignment start, lowers to swivel Z, turns the holder around the nominal blade-tip position to align with the first segment, and optionally advances along a straight lead-in at swivel Z. It then lowers to cut Z. Lead-in 0 aligns at the path start. Positive lead-in extends backward from the start along the first segment; it is not automatically placed in scrap and may mark adjacent artwork. Alignment can mark the surface even with zero lead-in.

For each desired cut segment the holder is advanced by the blade offset along the segment heading. At a vertex, a holder arc centered on the desired tip position changes heading. Turns at or above Corner threshold use swivel Z/feed; smaller turns use cut Z/feed, avoiding a Z lift on each sample of a curve. Swivel arcs are emitted as G1 chords (at most 5 degrees per chord and 0.005 mm nominal chord deviation). SVG curve accuracy still depends on import sample spacing. There is no smoothing that erases the original sampled corners. Exact 180-degree turns choose a semicircular turn and need inspection.

Green/cyan lines and the numbered start/end markers refer to the intended blade-tip cut. Blue overlay shows the compensated holder during cutting; orange shows holder alignment, lead-ins and swivels. Dashed lines are holder travel at safe Z. The Fit view includes compensated extents and the summary reports their width/height. The initial travel is visualized from work X0 Y0 but the actual machine may start elsewhere. Disable Show holder movement to inspect the original artwork. Zoom/pan and the resizable G-code pane remain available.

Ordering and automatic starts still use the intended cut geometry, not a global optimization of compensated holder travel. Manual start/direction selection and overlap are applied before compensation. There is no scrap-area, self-intersection, blade-body-clearance or machine-limit detection. The calibration button loads a square, circle, triangle and open line; it replaces the current imported artwork and resets path edits like Load example artwork.

Knife settings and the entry-alignment switch are included in saved presets. Version 0.3.0 presets with fixed knifeCutZ are migrated to Surface = Final = the saved cut Z, preserving their repeat count. Adjust Surface, Final and Step down to enable progression; re-save to store the new format.

Software validation: 13 existing planner checks, 11 dedicated knife checks (including G-code XYZ replay against the planned moves), 11 browser importer checks, browser preset persistence/migration, simulated Save As bridge, and responsive preview/layout checks. Plotter and laser output are checked against the previous installed core. No physical cuts or live machine commands were performed. Start with calibrated values on scrap to evaluate the passive blade's actual behavior.


## Entry controls and picking (0.3.1)

- Straight lead-in length = 0 removes straight entry extension, but does not remove entry alignment arcs.
- Uncheck **Align blade before each pass** to remove both entry arcs and straight lead-ins. The holder travels at safe Z straight to the compensated start, lowers to that pass's cutting Z, and cuts. This assumes the blade is already aligned with the first segment at EVERY pass. Without that alignment the initial cut can wander. No manual pause or automatic blade-orientation sensing is added. Corner swivels along the contour remain enabled.
- The initial heading setting applies only with entry alignment enabled. At 0 degrees the holder would move toward +X while the tip trails on its -X side. The orange loop is the holder moving around the ideal tip position, not an intended loop cut by the tip. Real contact turns can mark material. The planner assumes blade direction is retained during lifted travel.
- Pick start and Pick origin show a crosshair, including while the mouse button is held. Escape cancels point picking. Normal preview dragging keeps the grab cursor.
- Validation: 13 existing planner checks, 14 knife checks, browser progression and alignment controls, crosshair/escape behavior, preset migration and persistence, and simulated Save As. No machine movement or physical cutting was performed.


## Menus, picking and swivel lift (0.3.2)

All dropdowns use bounded, internally scrolling menus rendered inside the plugin iframe. They open above or below a control to fit the available height. Arrow keys, Home/End, typing to find an option, Enter and Escape are supported. The source select values remain the settings interface; dropdowns.js manages the visible menus.

Pick origin and Pick start focus the preview with preventScroll. They no longer call scrollIntoView, which can scroll ancestor frames and displace the hosting Dashboard. The plugin does not reposition or scroll the parent Dashboard.

Uncheck Lift for corner swivels to keep the current pass's cutting Z throughout corner turns. XY compensation arcs and swivel feed remain. Align blade before each pass separately controls entry alignment; disable that too to eliminate entry contact-Z movements. Setting the angle threshold to 180 degrees is not a universal off switch: exact reversals still meet that threshold. The lift toggle is saved in presets and older presets default to their previous enabled behavior.

Most visible explanatory notes are in index.html. Dynamic status and blade-heading explanations are in app.js. Geometry validation errors and G-code comments are in core.js. Import messages are in importer.js.

Validation: 13 planner checks, 15 knife checks, real SVG import, bounded-menu keyboard and long-list tests, small-window checks, mode/offset/lift preset persistence, and an embedded-frame regression that reproduces the old parent scroll and confirms origin picking no longer causes it. No physical machine operation was performed.


## Path visibility and nearby-node cleanup (0.3.3)

Intended cuts are rendered above holder movement: selected paths are thick cyan, other paths solid green, with a dark separation stroke. The thinner holder-cut overlay is dashed blue; holder swivel/alignment remains orange. Point markers and numbers remain above the overlay.

Nearby-node cleanup defaults to 0.1 mm for a new session. Zero disables cleanup. This is a proximity threshold, not a promise that all retained nodes are at least 0.1 mm apart: meaningful bends and endpoints can remain closer. A nearby redundant point is removed only if the replacement chord is within 0.001 mm (or the smaller selected threshold) of every sample it replaces. This avoids indiscriminately trimming real corners. Open endpoints, closed/open status, and at least three vertices for closed contours are preserved. Original sampled-point limits still apply before cleanup.

Cleanup applies in physical SVG millimeters before the plugin scale/rotation and before ordering or knife compensation. Scale also scales the cleanup deviation. It affects the preview and generated paths consistently, never edits the SVG file, and never closes an open path. Reimport is required after changing cleanup, resetting manual path starts/directions in the same way as other import settings. The field saves in presets; older presets without it load with cleanup off to preserve their previous behavior.

Open paths are now reported in the import notes. SVG fill visually closes an open outline for painting; this does not add a closing cut. An endpoint overlapping an earlier edge does not mark the path as closed. Only explicitly closed SVG subpaths/shapes are treated as closed for closed-path overlap and outer-contour ordering constraints.

Validated with the supplied A artwork: the two tiny reversal pairs are removed at 0.1 mm while original endpoints and open flags remain unchanged. Planner, knife, cleanup, browser importer, selection overlay and cleanup preset/reimport checks pass. No physical cuts were performed.
