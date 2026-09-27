# Rotate G-code — Dashboard plugin

Rotate, uniformly scale, flip, preview, and save the currently loaded G-code file. The UI follows the Nesting plugin layout: tabbed controls on the left, a live SVG preview beside the generated G-code, and a draggable divider between them.

## Install

Copy this folder into `%USERPROFILE%\\.ugs\\dashboard-plugins\\rotate-gcode\\` on Windows, `~/.ugs/dashboard-plugins/rotate-gcode/` on Linux, or the equivalent UGS settings directory on macOS. Reload Dashboard and choose **Rotate G-code**.

The plugin supports signed angle presets at 45-degree intervals, a −180° to +180° slider/manual field, uniform scale, horizontal/vertical flips, object-center or work-origin transform pivots, corner/center/keep/picked output origins, preview zoom/pan, presets, Copy, Overwrite, and Save As. The angle presets and narrow controls wrap within the tab column; the settings column follows Nesting's responsive sizing pattern instead of expanding indefinitely.

## Workflow

1. Open a G-code file in Dashboard and launch **Rotate G-code**.
2. Use the **Transform** tab to adjust the signed angle, uniform scale, flips, and transform pivot. The preview and generated G-code update as settings change.
3. Use the **Origin** tab to keep the existing coordinates, place the cut bounds at a corner or center, or pick a point from the preview. Output-origin placement translates the complete program, including rapid travel, but the selected bounds are calculated from cutting motion only.
4. Inspect the generated program, then use **Copy**, **Overwrite**, or **Save As…**. No machine command is sent by the plugin.

The preview shows cutting paths in green, rapid travel in dashed orange, and the output origin as a red cross. Use the wheel or the zoom buttons to zoom and drag the preview to pan it. The divider between the preview and generated G-code can be dragged to resize them.

The original G-code is retained until an explicit save action. Expression-bearing lines and controller/macro moves are kept unchanged; ordinary G0–G3 XY motion and I/J arc offsets are transformed together. Rapid G0 travel remains visible and is transformed with the program, but object-center and output-origin bounds use cutting motion only (G1/G2/G3), falling back to travel only when no cutting motion exists. The plugin does not automatically rewrite the first or last rapid move to `(0, 0)`; preserving those moves avoids changing the program's intended approach and park behavior.

Run `node rotate.test.cjs` for the parser and transform checks. A physical machine run has not been validated; inspect the generated file and verify the selected work origin and machine clearance before cutting.
