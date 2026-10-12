// How often a lost (or not-yet-made) connection to UGS is retried.
export const RECONNECT_INTERVAL_MS = 4000;

// "12 s", "1 min 5 s", "2 h 3 min" - how long the link has been down, shown on
// the reconnect overlay so a long outage doesn't look like a frozen page.
export function formatOutage(totalSeconds: number): string {
  const seconds = Math.max(0, Math.floor(totalSeconds));
  if (seconds < 60) return `${seconds} s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) {
    const rest = seconds % 60;
    return rest === 0 ? `${minutes} min` : `${minutes} min ${rest} s`;
  }
  const hours = Math.floor(minutes / 60);
  const restMinutes = minutes % 60;
  return restMinutes === 0 ? `${hours} h` : `${hours} h ${restMinutes} min`;
}
