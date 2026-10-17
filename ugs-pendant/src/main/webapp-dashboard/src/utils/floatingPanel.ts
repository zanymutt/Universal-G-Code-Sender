// Placement for a non-blocking floating panel (the Stock view's tool editor):
// where it first appears, and keeping it reachable while it is dragged. Pure,
// in the layout units position:fixed uses inside .app (see layoutRect.ts).

import type { Box, Size } from "./placePopover";

export type PanelPlacement = { left: number; top: number; width: number; maxHeight: number };

// Least height worth showing before the panel would rather start higher up.
const MIN_HEIGHT = 160;

// Beside the anchor (the settings popover) when there is room for the whole
// width, so both can be read together; otherwise tucked into the top right of
// the viewport. The user can drag it from there.
export const placeFloatingPanel = (
  anchor: Box | null,
  size: Size,
  viewport: Size,
  margin = 8,
  gap = 8
): PanelPlacement => {
  const width = Math.min(size.width, Math.max(0, viewport.width - margin * 2));
  let left = viewport.width - margin - width;
  let top = margin;
  if (anchor && anchor.right + gap + width <= viewport.width - margin) {
    left = anchor.right + gap;
    top = anchor.top;
  }
  top = Math.max(margin, Math.min(top, viewport.height - margin - MIN_HEIGHT));
  return { left, top, width, maxHeight: Math.max(MIN_HEIGHT, viewport.height - top - margin) };
};

// Keeps at least `grab` pixels of the header on screen on every side that
// matters, so the panel can always be dragged back.
export const clampPanelPosition = (
  left: number,
  top: number,
  width: number,
  viewport: Size,
  grab = 96,
  header = 44
) => ({
  left: Math.max(grab - width, Math.min(left, viewport.width - grab)),
  top: Math.max(0, Math.min(top, viewport.height - header)),
});
