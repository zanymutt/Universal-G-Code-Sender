export type Box = { left: number; top: number; right: number; bottom: number };
export type Size = { width: number; height: number };

export type PopoverPlacement = {
  left: number;
  top: number;
  width: number;
  // Set only when the content is taller than the room on either side, in which
  // case it should scroll; otherwise the popover shows in full with no scrollbar.
  maxHeight: number | null;
  side: "above" | "below";
};

// Where to put a popover so it stays entirely on screen: right-aligned to its
// anchor but clamped into the viewport horizontally (a narrow pane can leave the
// anchor closer to the left edge than the popover is wide), and above the anchor
// when its full height fits there, else below, else on whichever side has more
// room - shrinking to that room and scrolling as a last resort.
export const placePopover = (
  anchor: Box,
  content: Size,
  viewport: Size,
  margin = 8,
  gap = 6
): PopoverPlacement => {
  const width = Math.min(content.width, Math.max(0, viewport.width - margin * 2));
  const left = Math.max(margin, Math.min(anchor.right - width, viewport.width - margin - width));

  const above = anchor.top - gap - margin;
  const below = viewport.height - anchor.bottom - gap - margin;
  if (content.height <= above) {
    return { left, width, top: anchor.top - gap - content.height, maxHeight: null, side: "above" };
  }
  if (content.height <= below) {
    return { left, width, top: anchor.bottom + gap, maxHeight: null, side: "below" };
  }
  if (above >= below) {
    const height = Math.max(0, above);
    return { left, width, top: anchor.top - gap - height, maxHeight: height, side: "above" };
  }
  return { left, width, top: anchor.bottom + gap, maxHeight: Math.max(0, below), side: "below" };
};
