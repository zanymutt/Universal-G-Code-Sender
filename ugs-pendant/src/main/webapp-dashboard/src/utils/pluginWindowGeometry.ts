// Geometry for dragging and resizing a floating plugin window.
//
// All values are in the dashboard's layout pixels (the unit position:fixed
// inside the zoomed .app uses), not screen pixels - callers divide pointer
// deltas by the window's layoutScale first - so a drag tracks the finger
// exactly at any dashboard zoom.

export type Box = { left: number; top: number; width: number; height: number };

// Only these edges resize. The top edge is deliberately not one: the header
// (with the minimize/maximize/close buttons) sits there, and a window is moved
// by its header and then resized from below.
export type ResizeDirection = "e" | "w" | "s" | "se" | "sw";

export const MIN_WINDOW_WIDTH = 220;
export const MIN_WINDOW_HEIGHT = 160;
// Largest the window may grow, as a share of the viewport.
export const MAX_WIDTH_SHARE = 0.96;
export const MAX_HEIGHT_SHARE = 0.9;
// How much of the header must stay on screen so the window can always be
// grabbed again (a finger can't recover a window dragged fully off-screen).
export const KEEP_HEADER_VISIBLE = 80;
export const HEADER_HEIGHT = 36;

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(value, Math.max(min, max)));

export function resizeBox(
  start: Box,
  direction: ResizeDirection,
  dx: number,
  dy: number,
  viewport: { width: number; height: number }
): Box {
  const maxWidth = viewport.width * MAX_WIDTH_SHARE;
  const maxHeight = viewport.height * MAX_HEIGHT_SHARE;
  let { left, width, height } = start;

  if (direction.includes("e")) {
    width = clamp(start.width + dx, MIN_WINDOW_WIDTH, maxWidth);
  }
  if (direction.includes("w")) {
    // The right edge stays put while the left edge follows the pointer.
    width = clamp(start.width - dx, MIN_WINDOW_WIDTH, maxWidth);
    left = start.left + start.width - width;
  }
  if (direction.includes("s")) {
    height = clamp(start.height + dy, MIN_WINDOW_HEIGHT, maxHeight);
  }
  return { left, top: start.top, width, height };
}

export function moveBox(
  start: { left: number; top: number },
  size: { width: number },
  dx: number,
  dy: number,
  viewport: { width: number; height: number }
): { left: number; top: number } {
  return {
    left: clamp(start.left + dx, KEEP_HEADER_VISIBLE - size.width, viewport.width - KEEP_HEADER_VISIBLE),
    top: clamp(start.top + dy, 0, viewport.height - HEADER_HEIGHT),
  };
}
