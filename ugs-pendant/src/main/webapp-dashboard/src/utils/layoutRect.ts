export type LayoutRect = { left: number; top: number; width: number; height: number };

// An element's box in the same unscaled layout units that position:fixed
// coordinates use inside .app. getBoundingClientRect reports the *rendered*
// (scaled) box, which differs from layout units whenever the dashboard zoom's
// transform is active (see App.scss), so divide that scale back out. The
// transform's origin is the top-left of the viewport, so no offset is needed.
export const layoutScale = (element: HTMLElement): number => {
  const rect = element.getBoundingClientRect();
  return element.offsetWidth > 0 && rect.width > 0 ? rect.width / element.offsetWidth : 1;
};

export const layoutRect = (element: HTMLElement): LayoutRect => {
  const rect = element.getBoundingClientRect();
  const scale = layoutScale(element);
  return { left: rect.left / scale, top: rect.top / scale, width: rect.width / scale, height: rect.height / scale };
};

export const sameLayoutRect = (a: LayoutRect | null, b: LayoutRect | null) =>
  a === b ||
  (a !== null &&
    b !== null &&
    Math.abs(a.left - b.left) < 0.5 &&
    Math.abs(a.top - b.top) < 0.5 &&
    Math.abs(a.width - b.width) < 0.5 &&
    Math.abs(a.height - b.height) < 0.5);
