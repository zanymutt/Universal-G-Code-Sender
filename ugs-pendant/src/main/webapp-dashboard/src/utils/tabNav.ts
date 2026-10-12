// Which tab a key moves to in a horizontal tab list (WAI-ARIA tabs pattern):
// arrows wrap around, Home/End jump to the ends. Returns null for a key that
// isn't tab navigation, so the caller leaves the event alone.
export const nextTabIndex = (count: number, current: number, key: string): number | null => {
  if (count <= 0) return null;
  switch (key) {
    case "ArrowRight":
      return (current + 1) % count;
    case "ArrowLeft":
      return (current - 1 + count) % count;
    case "Home":
      return 0;
    case "End":
      return count - 1;
    default:
      return null;
  }
};
