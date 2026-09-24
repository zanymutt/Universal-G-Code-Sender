/*
    Copyright 2026 Will Winder

    This file is part of Universal Gcode Sender (UGS).

    UGS is free software: you can redistribute it and/or modify
    it under the terms of the GNU General Public License as published by
    the Free Software Foundation, either version 3 of the License, or
    (at your option) any later version.
 */
package com.willwinder.universalgcodesender.pendantui.v1.model;

import java.util.List;

/** The line count and findings produced by one G-code review pass. */
public record GcodeReviewResult(
        String fileName,
        int lineCount,
        List<GcodeReviewDiagnostic> diagnostics) {
}
