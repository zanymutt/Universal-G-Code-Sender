export type ToolpathPoint = { x: number; y: number; z: number };

export type ToolpathSegment = {
  start: ToolpathPoint;
  end: ToolpathPoint;
  rapid: boolean;
  arc: boolean;
  lineNumber: number;
  // The modal feed rate for this segment in the file's own units per minute, and
  // whether those units (coordinates and feed) are inches - together they let the
  // simulation time a cut as length / feed. Optional: older backends don't send
  // them, and the simulation then falls back to a uniform made-up clock.
  feedRate?: number;
  inches?: boolean;
  // The modal S word (laser/plasma power, spindle rpm) in effect for the
  // segment. Optional for the same reason: the stock-removal view treats a
  // missing value as "always at full power".
  spindleSpeed?: number;
};

export const getToolpath = (): Promise<ToolpathSegment[]> => {
  return fetch("/api/v1/visualizer/getToolpath").then((response) => {
    if (!response.ok) {
      throw new Error(`Couldn't load toolpath (${response.status})`);
    }
    return response.json();
  });
};
