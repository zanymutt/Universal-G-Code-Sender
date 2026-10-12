import type { LayoutState } from "../components/CenterPaneLayoutDemo";

// Whether a value read from storage or a file is a usable pane layout: one to
// four panes, each with an id, a content string and a rectangle, and numeric
// divider sizes.
export const isPaneLayout = (value: unknown): value is LayoutState => {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<LayoutState>;
  return Array.isArray(candidate.panes) && candidate.panes.length > 0 &&
    candidate.panes.length <= 4 && candidate.panes.every(pane =>
      pane && typeof pane.id === "number" && typeof pane.content === "string" && pane.rect &&
      typeof pane.rect.x0 === "number" && typeof pane.rect.x1 === "number" &&
      typeof pane.rect.y0 === "number" && typeof pane.rect.y1 === "number") &&
    !!candidate.sizes && Object.values(candidate.sizes).every(size => typeof size === "number" && Number.isFinite(size));
};
