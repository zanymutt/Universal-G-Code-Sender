/*
    Copyright 2026 Will Winder

    This file is part of Universal Gcode Sender (UGS).

    UGS is free software: you can redistribute it and/or modify
    it under the terms of the GNU General Public License as published by
    the Free Software Foundation, either version 3 of the License, or
    (at your option) any later version.

    UGS is distributed in the hope that it will be useful,
    but WITHOUT ANY WARRANTY; without even the implied warranty of
    MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
    GNU General Public License for more details.

    You should have received a copy of the GNU General Public License
    along with UGS.  If not, see <http://www.gnu.org/licenses/>.
 */
package com.willwinder.universalgcodesender.utils;

import org.apache.commons.lang3.StringUtils;

import java.util.Set;

/**
 * The set of file extensions UGS treats as gcode, shared by every place that
 * needs to recognize one - the desktop "Open File" dialog
 * ({@code GcodeFileTypeFilter}), the pendant/dashboard's workspace directory
 * listing, and its upload picker. Previously each of those kept its own
 * separate list, and the workspace listing's had drifted to only 3 of these
 * 7 extensions - a real-world gcode folder using e.g. .ngc or .cnc (both
 * common CAM post-processor outputs) would silently show up empty there
 * despite being fully visible to the desktop's own file picker.
 */
public final class GcodeFileExtensions {
    public static final Set<String> EXTENSIONS = Set.of("cnc", "gc", "nc", "ngc", "tap", "txt", "gcode");

    private GcodeFileExtensions() {
    }

    public static boolean isGcodeFile(String fileName) {
        return EXTENSIONS.stream().anyMatch(extension -> StringUtils.endsWithIgnoreCase(fileName, "." + extension));
    }
}
