// Pure text transform - no DOM or Fluid SDK access, so it's easy to reason
// about (and unit-test) independently of the plugin's UI.
//
// Only rewrites plain-numeric X/Y (and, on arcs, I/J) values on G0/G1/G2/G3
// motion lines. A line is left completely untouched if:
//   - it contains a FluidNC expression/variable marker ({, }, #, ?), or
//   - its active G-word is something other than G0-G3 that also carries
//     X/Y (G10 offsets, G28/G30 predefined positions, G53 machine
//     coordinates, G92 set-position) - these aren't toolpath geometry and
//     rotating them would be actively wrong, not just unnecessary.
// This is deliberate and conservative: the plugin has no business trying to
// evaluate FluidNC's expression language, only rewriting the literal
// coordinates a CAM post actually emitted. If/then/probing macros pass
// through exactly as written.
(function (global) {
  const MOTION_WORD = /\bG0*([0-3])(?![0-9])/i;
  // No "." in this lookahead (unlike MOTION_WORD's) - G28.1/G28.2/G28.3,
  // G30.1, and G92.1-.4 are real FluidNC/GRBL words for the same family of
  // non-toolpath commands as their bare G28/G30/G92 counterparts (recording
  // or canceling a reference position - exactly what a probing macro uses),
  // and need to be disqualified exactly the same way. A dot-exclusion here
  // let those slip through as ordinary motion lines instead.
  const DISQUALIFYING_WORD = /\bG0*(4|10|28|30|53|92)(?![0-9])/i; // dwell, offsets, homing, machine coords, set-position
  const EXPRESSION_MARKERS = /[{}#?]/;
  const NUMBER = "(-?\\d*\\.?\\d+)";

  function stripComment(line) {
    // Handles both grbl-style "(...)" comments and a trailing ";" comment.
    // Not a full gcode-comment grammar (e.g. doesn't handle nested parens),
    // but real CAM-generated files don't produce those.
    return line.replace(/\(.*?\)/g, "").replace(/;.*/g, "");
  }

  function rotateVector(x, y, cos, sin) {
    return [x * cos - y * sin, x * sin + y * cos];
  }

  function trimNumber(n) {
    // 4 decimal places covers real-world CAM precision without the long
    // floating-point tails raw rotation math produces (12.000000000000002).
    return (Math.round(n * 10000) / 10000).toString();
  }

  // Shared by both passes below: given the running modal state and one
  // line, figures out whether this line is a rotatable motion line and, if
  // so, what its (possibly modal-inherited) X/Y values resolve to. Mutates
  // `state` in place to advance position/modal tracking either way, since
  // every line - rotatable or not - can still change G90/G91 or the
  // current position.
  function readMotionLine(code, state) {
    if (/\bG91\b/i.test(code)) state.absolute = false;
    if (/\bG90\b/i.test(code)) state.absolute = true;

    const motionMatch = code.match(MOTION_WORD);
    if (motionMatch) state.motion = motionMatch[1];

    const disqualifyingMatch = code.match(DISQUALIFYING_WORD);
    const disqualified = !!disqualifyingMatch;
    const xMatch = code.match(new RegExp("X" + NUMBER, "i"));
    const yMatch = code.match(new RegExp("Y" + NUMBER, "i"));
    const iMatch = code.match(new RegExp("I" + NUMBER, "i"));
    const jMatch = code.match(new RegExp("J" + NUMBER, "i"));

    const hasCoords = xMatch || yMatch || iMatch || jMatch;
    const rotatable = !disqualified && state.motion !== null && hasCoords;

    // G92 redefines the current position outright - independent of G90/G91
    // and independent of whether a motion mode is even active yet - so it
    // needs to update the tracked position directly from whatever axes it
    // specifies, even though its own line is never rewritten. Without this,
    // a later bare/modal-continuation line (a probing macro dropping back
    // into plain motion after recording a reference position, say) would
    // inherit whatever position was tracked *before* the G92, not the one
    // it just declared.
    if (disqualifyingMatch && disqualifyingMatch[1] === "92") {
      if (xMatch) state.x = parseFloat(xMatch[1]);
      if (yMatch) state.y = parseFloat(yMatch[1]);
    } else if (!disqualified && state.motion !== null && (xMatch || yMatch)) {
      // Advance the running absolute position regardless of whether this
      // line ends up being rotated, so bounding-box tracking and any later
      // line's modal-inherited X/Y stay correct either way.
      const rawX = xMatch ? parseFloat(xMatch[1]) : state.absolute ? state.x : 0;
      const rawY = yMatch ? parseFloat(yMatch[1]) : state.absolute ? state.y : 0;
      if (state.absolute) {
        if (xMatch) state.x = rawX;
        if (yMatch) state.y = rawY;
      } else {
        if (xMatch) state.x += rawX;
        if (yMatch) state.y += rawY;
      }
    }

    return { rotatable, xMatch, yMatch, iMatch, jMatch };
  }

  // angleDegrees follows the standard math convention: positive = counter-
  // clockwise, negative = clockwise. index.html passes the value straight
  // through unchanged.
  function rotateGcode(text, angleDegrees, pivotMode) {
    const angle = (angleDegrees * Math.PI) / 180;
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    const lines = text.split(/\r?\n/);

    // Pass 1: walk the file just to find the absolute-position bounding
    // box, so "rotate around toolpath center" has a center to use. Lines
    // with an expression marker are skipped for this too (their X/Y, if
    // any, isn't a plain coordinate to begin with).
    const boundsState = { x: 0, y: 0, absolute: true, motion: null };
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity, sawPoint = false;

    for (const rawLine of lines) {
      const code = stripComment(rawLine);
      if (!code.trim() || EXPRESSION_MARKERS.test(code)) continue;
      const before = { x: boundsState.x, y: boundsState.y };
      readMotionLine(code, boundsState);
      if (boundsState.x !== before.x || boundsState.y !== before.y) {
        sawPoint = true;
        minX = Math.min(minX, boundsState.x);
        maxX = Math.max(maxX, boundsState.x);
        minY = Math.min(minY, boundsState.y);
        maxY = Math.max(maxY, boundsState.y);
      }
    }

    const pivotX = pivotMode === "center" && sawPoint ? (minX + maxX) / 2 : 0;
    const pivotY = pivotMode === "center" && sawPoint ? (minY + maxY) / 2 : 0;

    // Pass 2: same modal tracking, this time actually rewriting each
    // qualifying line's X/Y/I/J tokens in place. Runs from a fresh
    // starting position rather than continuing from pass 1's end state -
    // both passes read the same original, unrotated coordinates.
    const state = { x: 0, y: 0, absolute: true, motion: null };
    let rotatedCount = 0;

    const outputLines = lines.map((rawLine) => {
      const code = stripComment(rawLine);
      if (!code.trim() || EXPRESSION_MARKERS.test(code)) return rawLine;

      const beforeAbsolute = state.absolute;
      const beforeX = state.x;
      const beforeY = state.y;
      const { rotatable, xMatch, yMatch, iMatch, jMatch } = readMotionLine(code, state);
      if (!rotatable) return rawLine;

      let newLine = rawLine;

      if (xMatch || yMatch) {
        const rawX = xMatch ? parseFloat(xMatch[1]) : beforeAbsolute ? beforeX : 0;
        const rawY = yMatch ? parseFloat(yMatch[1]) : beforeAbsolute ? beforeY : 0;

        // Absolute coordinates rotate around the chosen pivot; a relative
        // (G91) move is a delta vector and only ever rotates around the
        // origin - offsetting it by a pivot wouldn't mean anything, since
        // it was never a position to begin with.
        const [rx, ry] = beforeAbsolute
          ? (() => {
              const [ux, uy] = rotateVector(rawX - pivotX, rawY - pivotY, cos, sin);
              return [ux + pivotX, uy + pivotY];
            })()
          : rotateVector(rawX, rawY, cos, sin);

        if (xMatch) newLine = newLine.replace(xMatch[0], "X" + trimNumber(rx));
        if (yMatch) newLine = newLine.replace(yMatch[0], "Y" + trimNumber(ry));
      }

      // Arc center offsets are always incremental vectors regardless of
      // G90/G91 distance mode (standard GRBL/FluidNC behavior) - rotated
      // the same way a G91 move is, never pivot-adjusted.
      if (iMatch || jMatch) {
        const rawI = iMatch ? parseFloat(iMatch[1]) : 0;
        const rawJ = jMatch ? parseFloat(jMatch[1]) : 0;
        const [ri, rj] = rotateVector(rawI, rawJ, cos, sin);
        if (iMatch) newLine = newLine.replace(iMatch[0], "I" + trimNumber(ri));
        if (jMatch) newLine = newLine.replace(jMatch[0], "J" + trimNumber(rj));
      }

      rotatedCount++;
      return newLine;
    });

    return {
      text: outputLines.join("\n"),
      rotatedLineCount: rotatedCount,
      pivot: { x: pivotX, y: pivotY },
    };
  }

  global.rotateGcode = rotateGcode;
})(window);
