import { useEffect, useState } from "react";
import { LayoutRect, layoutRect, sameLayoutRect } from "../utils/layoutRect";

// Tracks an element's box (in position:fixed layout units) for as long as
// `enabled`, re-measuring when it resizes or the window does. Null while
// disabled or if the element isn't on the page.
export const useLayoutRect = (selector: string, enabled: boolean): LayoutRect | null => {
  const [rect, setRect] = useState<LayoutRect | null>(null);

  useEffect(() => {
    if (!enabled) return;
    const element = document.querySelector<HTMLElement>(selector);
    if (!element) {
      setRect(null);
      return;
    }
    const update = () => {
      const next = layoutRect(element);
      setRect((prev) => (sameLayoutRect(prev, next) ? prev : next));
    };
    update();
    window.addEventListener("resize", update);
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(update);
    observer?.observe(element);
    return () => {
      window.removeEventListener("resize", update);
      observer?.disconnect();
    };
  }, [selector, enabled]);

  return enabled ? rect : null;
};
