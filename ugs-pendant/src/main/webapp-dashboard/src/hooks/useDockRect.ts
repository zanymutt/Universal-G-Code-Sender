import { useEffect, useState } from "react";
import { LayoutRect, layoutRect, sameLayoutRect } from "../utils/layoutRect";

// How often to re-measure as a safety net. A ResizeObserver only reports an
// element changing *size*; a dock slot can also just move (a neighbouring
// column resizing, a bar above it wrapping onto another row) while keeping its
// own size, and nothing event-driven reports that. Cheap: one query + one
// getBoundingClientRect, only while something is docked.
const POLL_MS = 250;

export const dockSlotSelector = (slot: string) => `[data-plugin-dock-slot="${slot.replace(/["\\]/g, "")}"]`;

// The box of whichever element currently carries data-plugin-dock-slot=<slot>,
// in the unscaled layout units position:fixed uses inside the zoomed .app (see
// layoutRect). Null when there's no slot, the element isn't on the page, or it
// has no size (an ancestor is display:none) - the caller hides the docked
// window then instead of leaving it parked over something else.
//
// Looks the element up again on every measure rather than caching it: a pane
// being re-created must not strand the window over a detached node.
export const useDockRect = (slot: string | null): LayoutRect | null => {
  const [rect, setRect] = useState<LayoutRect | null>(null);

  useEffect(() => {
    if (slot === null) {
      setRect(null);
      return;
    }
    const selector = dockSlotSelector(slot);
    let observed: Element | null = null;
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(() => update());

    function update() {
      const element = document.querySelector<HTMLElement>(selector);
      if (element !== observed) {
        if (observed) observer?.unobserve(observed);
        if (element) observer?.observe(element);
        observed = element;
      }
      const next = element && element.offsetWidth > 0 && element.offsetHeight > 0 ? layoutRect(element) : null;
      setRect((prev) => (sameLayoutRect(prev, next) ? prev : next));
    }

    update();
    window.addEventListener("resize", update);
    const timer = window.setInterval(update, POLL_MS);
    return () => {
      window.removeEventListener("resize", update);
      window.clearInterval(timer);
      observer?.disconnect();
    };
  }, [slot]);

  return slot === null ? null : rect;
};
