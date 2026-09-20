package com.willwinder.universalgcodesender.pendantui.v1.model;

/**
 * One straight piece of the toolpath (arcs arrive already broken into many of these).
 *
 * @param feedRate the modal feed rate in effect for this segment, in the file's own units per
 *                 minute (mm/min for G21, in/min for G20) - the same units as the coordinates,
 *                 so length / feedRate is a time whichever unit the file uses. 0 if no F word
 *                 had been seen yet. Rapids carry the modal feed too but move at machine speed.
 * @param inches   whether the coordinates (and feedRate) are in inches rather than millimeters
 */
public record ToolpathSegment(ToolpathPoint start, ToolpathPoint end, boolean rapid, boolean arc, int lineNumber,
                              double feedRate, boolean inches) {
}
