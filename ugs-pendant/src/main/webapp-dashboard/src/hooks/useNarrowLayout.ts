import { useEffect, useState } from "react";

// Same threshold the old (buggy) 3-column stack used - kept, not reinvented,
// since testing against real device widths confirmed it's still the right
// line: iPad landscape (1194px) holds up fine as the normal 3-column
// layout, iPad portrait (834px) needs the tabbed one below it.
const NARROW_QUERY = "(max-width: 900px)";

// A real matchMedia listener, not a resize listener - fires only when the
// query's result actually flips, and (unlike a resize handler) gives the
// right answer immediately on mount without waiting for a first resize.
export function useNarrowLayout(): boolean {
  const [isNarrow, setIsNarrow] = useState(() => window.matchMedia(NARROW_QUERY).matches);

  useEffect(() => {
    const mediaQuery = window.matchMedia(NARROW_QUERY);
    const listener = (event: MediaQueryListEvent) => setIsNarrow(event.matches);
    mediaQuery.addEventListener("change", listener);
    setIsNarrow(mediaQuery.matches);
    return () => mediaQuery.removeEventListener("change", listener);
  }, []);

  return isNarrow;
}
