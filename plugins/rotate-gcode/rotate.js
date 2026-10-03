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

  // The compass points (0/90/180/270 degrees) an arc actually passes through,
  // as [x, y]. A rotation pivot taken from move end points alone misses how far
  // an arc bulges past them, so "toolpath center" wouldn't be the middle of
  // what's really cut. Start = end is a full circle, as G-code defines it.
  function arcExtremes(sx, sy, ex, ey, cx, cy, clockwise) {
    const radius = Math.hypot(sx - cx, sy - cy);
    if (!(radius > 0)) return [];
    const TWO_PI = 2 * Math.PI;
    const start = Math.atan2(sy - cy, sx - cx);
    let sweep = Math.atan2(ey - cy, ex - cx) - start;
    if (clockwise) {
      while (sweep >= 0) sweep -= TWO_PI;
    } else {
      while (sweep <= 0) sweep += TWO_PI;
    }
    const points = [];
    for (let quarter = 0; quarter < 4; quarter++) {
      const angle = (quarter * Math.PI) / 2;
      let offset = clockwise ? start - angle : angle - start;
      while (offset < 0) offset += TWO_PI;
      // A hair of tolerance so a compass point exactly at the start or end counts.
      if (offset <= Math.abs(sweep) + 1e-9) {
        points.push([cx + radius * Math.cos(angle), cy + radius * Math.sin(angle)]);
      }
    }
    return points;
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
    if (/\bG17\b/i.test(code)) state.plane = 17;
    if (/\bG18\b/i.test(code)) state.plane = 18;
    if (/\bG19\b/i.test(code)) state.plane = 19;

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
    const boundsState = { x: 0, y: 0, absolute: true, motion: null, plane: 17 };
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity, sawPoint = false;

    for (const rawLine of lines) {
      const code = stripComment(rawLine);
      if (!code.trim() || EXPRESSION_MARKERS.test(code)) continue;
      const before = { x: boundsState.x, y: boundsState.y };
      const { rotatable, iMatch, jMatch } = readMotionLine(code, boundsState);
      const include = (x, y) => {
        sawPoint = true;
        minX = Math.min(minX, x);
        maxX = Math.max(maxX, x);
        minY = Math.min(minY, y);
        maxY = Math.max(maxY, y);
      };
      if (boundsState.x !== before.x || boundsState.y !== before.y) include(boundsState.x, boundsState.y);
      // I/J arcs in the XY plane (G17) reach past their end points. A full circle
      // doesn't move at all, so this can't hang off the position check above.
      const isArc = boundsState.motion === "2" || boundsState.motion === "3";
      if (rotatable && isArc && boundsState.plane === 17 && (iMatch || jMatch)) {
        const cx = before.x + (iMatch ? parseFloat(iMatch[1]) : 0);
        const cy = before.y + (jMatch ? parseFloat(jMatch[1]) : 0);
        arcExtremes(before.x, before.y, boundsState.x, boundsState.y, cx, cy, boundsState.motion === "2").forEach(
          ([x, y]) => include(x, y)
        );
      }
    }

    const pivotX = pivotMode === "center" && sawPoint ? (minX + maxX) / 2 : 0;
    const pivotY = pivotMode === "center" && sawPoint ? (minY + maxY) / 2 : 0;

    // Pass 2: same modal tracking, this time actually rewriting each
    // qualifying line's X/Y/I/J tokens in place. Runs from a fresh
    // starting position rather than continuing from pass 1's end state -
    // both passes read the same original, unrotated coordinates.
    const state = { x: 0, y: 0, absolute: true, motion: null, plane: 17 };
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

        // Both axes are always written. A move that names only one axis
        // ("G1 X70", or a bare "Y20") leaves the other at wherever the tool
        // already was - but once rotated, the target's other coordinate
        // changes too, so rewriting just the axis that was there would drop
        // it and skew the shape (a horizontal edge would stop being a line).
        // The missing word goes right beside the one that's present.
        const xWord = "X" + trimNumber(rx);
        const yWord = "Y" + trimNumber(ry);
        if (xMatch && yMatch) {
          newLine = newLine.replace(xMatch[0], xWord).replace(yMatch[0], yWord);
        } else if (xMatch) {
          newLine = newLine.replace(xMatch[0], xWord + " " + yWord);
        } else {
          newLine = newLine.replace(yMatch[0], xWord + " " + yWord);
        }
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

  // -----------------------------------------------------------------------
  // General transform / preview support used by the redesigned plugin.
  // The original rotateGcode() API remains above for compatibility with the
  // first version and its tests.

  function sampleArc(sx, sy, ex, ey, cx, cy, clockwise) {
    const radius = Math.hypot(sx - cx, sy - cy);
    if (!(radius > 0)) return [[sx, sy], [ex, ey]];
    const start = Math.atan2(sy - cy, sx - cx);
    const end = Math.atan2(ey - cy, ex - cx);
    let sweep = end - start;
    if (clockwise) {
      while (sweep >= 0) sweep -= Math.PI * 2;
    } else {
      while (sweep <= 0) sweep += Math.PI * 2;
    }
    if (Math.hypot(ex - sx, ey - sy) < 1e-9) sweep = clockwise ? -Math.PI * 2 : Math.PI * 2;
    const count = Math.max(8, Math.min(256, Math.ceil(Math.abs(sweep) * radius / 2)));
    const points = [];
    for (let i = 0; i <= count; i++) {
      const a = start + sweep * (i / count);
      points.push([cx + radius * Math.cos(a), cy + radius * Math.sin(a)]);
    }
    // Preserve the exact endpoint from the file instead of a sampled value.
    points[points.length - 1] = [ex, ey];
    return points;
  }

  function emptyBounds() {
    return { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity, sawPoint: false };
  }

  function includePoint(bounds, point) {
    bounds.sawPoint = true;
    bounds.minX = Math.min(bounds.minX, point[0]);
    bounds.minY = Math.min(bounds.minY, point[1]);
    bounds.maxX = Math.max(bounds.maxX, point[0]);
    bounds.maxY = Math.max(bounds.maxY, point[1]);
  }

  function finishBounds(bounds) {
    if (bounds.sawPoint) return bounds;
    return { minX: 0, minY: 0, maxX: 0, maxY: 0, sawPoint: false };
  }

  // Extracts drawable XY geometry once. The preview deliberately follows the
  // same conservative motion rules as the text transformer: macros, probing,
  // machine-coordinate moves, and expression-bearing lines are omitted.
  function extractToolpath(text) {
    const state = { x: 0, y: 0, absolute: true, motion: null, plane: 17 };
    const segments = [];
    const allBounds = emptyBounds();
    const cutBounds = emptyBounds();
    for (const rawLine of String(text ?? "").split(/\r?\n/)) {
      const code = stripComment(rawLine);
      if (!code.trim() || EXPRESSION_MARKERS.test(code)) continue;
      const before = { x: state.x, y: state.y };
      const info = readMotionLine(code, state);
      if (!info.rotatable) continue;
      const isArc = state.motion === "2" || state.motion === "3";
      const hasXY = !!(info.xMatch || info.yMatch);
      let points;
      if (isArc && state.plane === 17 && (info.iMatch || info.jMatch)) {
        const cx = before.x + (info.iMatch ? parseFloat(info.iMatch[1]) : 0);
        const cy = before.y + (info.jMatch ? parseFloat(info.jMatch[1]) : 0);
        points = sampleArc(before.x, before.y, state.x, state.y, cx, cy, state.motion === "2");
      } else if (hasXY) {
        points = [[before.x, before.y], [state.x, state.y]];
      } else {
        continue;
      }
      segments.push({ rapid: state.motion === "0", points });
      points.forEach(point => {
        includePoint(allBounds, point);
        if (state.motion !== "0") includePoint(cutBounds, point);
      });
    }
    // Rapids remain visible in the preview, but they are travel geometry, not
    // part of the cut object's extents. If a file contains no G1/G2/G3 XY
    // motion, fall back to all motion so the preview is still useful.
    return {
      segments,
      bounds: finishBounds(cutBounds.sawPoint ? cutBounds : allBounds),
      allBounds: finishBounds(allBounds),
      hasCuts: cutBounds.sawPoint,
    };
  }

  function transformVector(x, y, options) {
    const scale = options.scale;
    let dx = x * scale;
    let dy = y * scale;
    if (options.flipHorizontal) dx = -dx;
    if (options.flipVertical) dy = -dy;
    const angle = (options.angle * Math.PI) / 180;
    const cos = Math.cos(angle), sin = Math.sin(angle);
    return [dx * cos - dy * sin, dx * sin + dy * cos];
  }

  function transformPoint(point, pivot, options) {
    const vector = transformVector(point[0] - pivot[0], point[1] - pivot[1], options);
    return [pivot[0] + vector[0], pivot[1] + vector[1]];
  }

  function transformedBounds(segments, pivot, options, translation) {
    const bounds = emptyBounds();
    segments.forEach(segment => segment.points.forEach(point => {
      const transformed = transformPoint(point, pivot, options);
      includePoint(bounds, [transformed[0] + translation[0], transformed[1] + translation[1]]);
    }));
    return finishBounds(bounds);
  }

  function targetForOrigin(origin, bounds, customPoint, pivot, options) {
    if (origin === "bottom-left") return [bounds.minX, bounds.minY];
    if (origin === "bottom-right") return [bounds.maxX, bounds.minY];
    if (origin === "top-left") return [bounds.minX, bounds.maxY];
    if (origin === "top-right") return [bounds.maxX, bounds.maxY];
    if (origin === "center") return [(bounds.minX + bounds.maxX) / 2, (bounds.minY + bounds.maxY) / 2];
    if (origin === "custom" && customPoint) {
      const point = Array.isArray(customPoint) ? customPoint : [Number(customPoint.x) || 0, Number(customPoint.y) || 0];
      return transformPoint(point, pivot, options);
    }
    return [0, 0];
  }

  function transformGcode(text, rawOptions = {}) {
    const geometry = extractToolpath(text);
    const sourceBounds = geometry.bounds;
    const options = {
      angle: Number.isFinite(Number(rawOptions.angle)) ? Number(rawOptions.angle) : 0,
      scale: Number.isFinite(Number(rawOptions.scale)) && Number(rawOptions.scale) > 0 ? Number(rawOptions.scale) : 1,
      flipHorizontal: !!rawOptions.flipHorizontal,
      flipVertical: !!rawOptions.flipVertical,
    };
    const pivot = rawOptions.pivotMode === "origin" || !sourceBounds.sawPoint
      ? [0, 0]
      : [(sourceBounds.minX + sourceBounds.maxX) / 2, (sourceBounds.minY + sourceBounds.maxY) / 2];
    const noTranslation = [0, 0];
    const transformed = geometry.segments.map(segment => ({
      rapid: segment.rapid,
      points: segment.points.map(point => transformPoint(point, pivot, options)),
    }));
    const originSegments = geometry.hasCuts
      ? geometry.segments.filter(segment => !segment.rapid)
      : geometry.segments;
    const transformedOnlyBounds = transformed.reduce((bounds, segment) => {
      if (geometry.hasCuts && segment.rapid) return bounds;
      segment.points.forEach(point => includePoint(bounds, point));
      return bounds;
    }, emptyBounds());
    const transformedBoundsValue = finishBounds(transformedOnlyBounds);
    const target = targetForOrigin(rawOptions.origin || "keep", transformedBoundsValue, rawOptions.customOrigin, pivot, options);
    const translation = (rawOptions.origin && rawOptions.origin !== "keep")
      ? [-target[0], -target[1]]
      : noTranslation;
    const outputSegments = transformed.map(segment => ({
      rapid: segment.rapid,
      points: segment.points.map(point => [point[0] + translation[0], point[1] + translation[1]]),
    }));
    const outputBounds = transformedBounds(originSegments, pivot, options, translation);

    const reflection = options.flipHorizontal !== options.flipVertical;
    const state = { x: 0, y: 0, absolute: true, motion: null, plane: 17 };
    let transformedLineCount = 0;
    const outputLines = String(text ?? "").split(/\r?\n/).map(rawLine => {
      const code = stripComment(rawLine);
      if (!code.trim() || EXPRESSION_MARKERS.test(code)) return rawLine;
      const beforeAbsolute = state.absolute;
      const beforeX = state.x;
      const beforeY = state.y;
      const info = readMotionLine(code, state);
      if (!info.rotatable) return rawLine;
      let newLine = rawLine;
      if (info.xMatch || info.yMatch) {
        const rawX = info.xMatch ? parseFloat(info.xMatch[1]) : beforeAbsolute ? beforeX : 0;
        const rawY = info.yMatch ? parseFloat(info.yMatch[1]) : beforeAbsolute ? beforeY : 0;
        const transformedPoint = beforeAbsolute
          ? transformPoint([rawX, rawY], pivot, options).map((value, axis) => value + translation[axis])
          : transformVector(rawX, rawY, options);
        const xWord = "X" + trimNumber(transformedPoint[0]);
        const yWord = "Y" + trimNumber(transformedPoint[1]);
        if (info.xMatch && info.yMatch) {
          newLine = newLine.replace(info.xMatch[0], xWord).replace(info.yMatch[0], yWord);
        } else if (info.xMatch) {
          newLine = newLine.replace(info.xMatch[0], xWord + " " + yWord);
        } else {
          newLine = newLine.replace(info.yMatch[0], xWord + " " + yWord);
        }
      }
      if (info.iMatch || info.jMatch) {
        const vector = transformVector(info.iMatch ? parseFloat(info.iMatch[1]) : 0, info.jMatch ? parseFloat(info.jMatch[1]) : 0, options);
        if (info.iMatch) newLine = newLine.replace(info.iMatch[0], "I" + trimNumber(vector[0]));
        if (info.jMatch) newLine = newLine.replace(info.jMatch[0], "J" + trimNumber(vector[1]));
      }
      const rMatch = code.match(new RegExp("R" + NUMBER, "i"));
      if (rMatch && options.scale !== 1) newLine = newLine.replace(rMatch[0], "R" + trimNumber(parseFloat(rMatch[1]) * options.scale));
      if (reflection && (state.motion === "2" || state.motion === "3")) {
        const replacement = state.motion === "2" ? "G3" : "G2";
        newLine = newLine.replace(/\bG0*[23](?![0-9])/i, replacement);
      }
      transformedLineCount++;
      return newLine;
    });

    return {
      text: outputLines.join("\n"),
      transformedLineCount,
      pivot: { x: pivot[0], y: pivot[1] },
      translation: { x: translation[0], y: translation[1] },
      sourceBounds,
      outputBounds,
      preview: { sourceSegments: geometry.segments, outputSegments },
    };
  }

  global.rotateGcode = rotateGcode;
  global.extractToolpath = extractToolpath;
  global.transformGcode = transformGcode;
})(window);
