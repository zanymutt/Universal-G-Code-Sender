/*
    Copyright 2026 Will Winder

    This file is part of Universal Gcode Sender (UGS).

    UGS is free software: you can redistribute it and/or modify
    it under the terms of the GNU General Public License as published by
    the Free Software Foundation, either version 3 of the License, or
    (at your option) any later version.
 */
package com.willwinder.universalgcodesender.pendantui.v1.resources;

import com.willwinder.universalgcodesender.gcode.GcodeParser;
import com.willwinder.universalgcodesender.gcode.GcodePreprocessorUtils;
import com.willwinder.universalgcodesender.gcode.processors.CommentProcessor;
import com.willwinder.universalgcodesender.gcode.processors.WhitespaceProcessor;
import com.willwinder.universalgcodesender.gcode.util.Code;
import com.willwinder.universalgcodesender.gcode.util.GcodeParserException;
import com.willwinder.universalgcodesender.pendantui.v1.model.GcodeReviewDiagnostic;
import com.willwinder.universalgcodesender.pendantui.v1.model.GcodeReviewResult;

import java.util.ArrayList;
import java.util.List;
import java.util.regex.Pattern;

/**
 * Runs the same core parser used by the visualizer, but keeps going after a
 * line fails so the dashboard can show all findings in one pass.
 *
 * This is intentionally advisory. Controller-specific words are warnings,
 * while failures from the shared parser are errors.
 */
public final class GcodeReviewService {
    private static final Pattern NUMERIC_WORD = Pattern.compile("(?i)^([GMXYZABCIJKRFSNTPLOUVWHEQD])(.+)$");

    private GcodeReviewService() {
    }

    public static GcodeReviewResult review(String fileName, String content) {
        String sourceText = content == null ? "" : content;
        String[] lines = sourceText.split("\\R", -1);
        List<GcodeReviewDiagnostic> diagnostics = new ArrayList<>();

        GcodeParser parser = new GcodeParser();
        parser.addCommandProcessor(new CommentProcessor());
        parser.addCommandProcessor(new WhitespaceProcessor());

        for (int index = 0; index < lines.length; index++) {
            int lineNumber = index + 1;
            String line = lines[index];
            inspectWords(line, lineNumber, diagnostics);

            try {
                List<String> commands = parser.preprocessCommand(line, parser.getCurrentState());
                for (String command : commands) {
                    parser.addCommand(command, lineNumber);
                }
            } catch (GcodeParserException | RuntimeException exception) {
                String message = exception.getMessage();
                diagnostics.add(new GcodeReviewDiagnostic(
                        lineNumber,
                        "ERROR",
                        message == null || message.isBlank() ? "G-code parser rejected this line." : message,
                        line));
            }
        }

        return new GcodeReviewResult(fileName == null ? "" : fileName, lines.length, diagnostics);
    }

    private static void inspectWords(String line, int lineNumber, List<GcodeReviewDiagnostic> diagnostics) {
        int motionCodeCount = 0;
        for (String word : GcodePreprocessorUtils.splitCommand(line)) {
            if (word.isEmpty() || word.startsWith("(") || word.startsWith(";") || word.startsWith("$")) {
                continue;
            }

            char address = Character.toUpperCase(word.charAt(0));
            if (address == 'G' || address == 'M') {
                Code code = Code.lookupCode(word);
                if (code == Code.UNKNOWN) {
                    diagnostics.add(new GcodeReviewDiagnostic(
                            lineNumber,
                            "WARNING",
                            "Unknown " + address + "-code '" + word + "'. The controller may support it.",
                            line));
                } else if (isMotionCode(code)) {
                    motionCodeCount++;
                }
            }

            var numericMatch = NUMERIC_WORD.matcher(word);
            if (numericMatch.matches() && !isFiniteNumber(numericMatch.group(2))) {
                diagnostics.add(new GcodeReviewDiagnostic(
                        lineNumber,
                        "ERROR",
                        "Malformed numeric word '" + word + "'.",
                        line));
            }
        }

        if (motionCodeCount > 1) {
            diagnostics.add(new GcodeReviewDiagnostic(
                    lineNumber,
                    "ERROR",
                    "multiple motion codes appear in one block.",
                    line));
        }
    }

    private static boolean isMotionCode(Code code) {
        return switch (code) {
            case G0, G1, G2, G3,
                    G38_2, G38_3, G38_4, G38_5,
                    G80, G81, G82, G83, G84, G85, G86, G87, G88, G89 -> true;
            default -> false;
        };
    }

    private static boolean isFiniteNumber(String value) {
        try {
            return Double.isFinite(Double.parseDouble(value));
        } catch (NumberFormatException exception) {
            return false;
        }
    }
}
