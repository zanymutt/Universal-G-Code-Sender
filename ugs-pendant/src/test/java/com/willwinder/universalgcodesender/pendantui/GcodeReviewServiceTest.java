package com.willwinder.universalgcodesender.pendantui;

import com.willwinder.universalgcodesender.pendantui.v1.model.GcodeReviewDiagnostic;
import com.willwinder.universalgcodesender.pendantui.v1.model.GcodeReviewResult;
import com.willwinder.universalgcodesender.pendantui.v1.resources.GcodeReviewService;
import org.junit.Test;

import java.util.List;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertTrue;

public class GcodeReviewServiceTest {
    @Test
    public void reportsParserErrorsAndUnknownCodesWithSourceLines() {
        GcodeReviewResult result = GcodeReviewService.review("job.nc", String.join("\n",
                "G21",
                "G1 X10 Y10 F100",
                "G1 Xbad Y20",
                "G999 X30",
                "G0 G1 X40"));

        assertEquals(5, result.lineCount());
        List<GcodeReviewDiagnostic> diagnostics = result.diagnostics();
        assertTrue(diagnostics.stream().anyMatch(d -> d.lineNumber() == 3
                && d.severity().equals("ERROR")
                && d.message().contains("Malformed numeric word")
                && d.source().equals("G1 Xbad Y20")));
        assertTrue(diagnostics.stream().anyMatch(d -> d.lineNumber() == 4
                && d.severity().equals("WARNING")
                && d.message().contains("Unknown G-code 'G999'")));
        assertTrue(diagnostics.stream().anyMatch(d -> d.lineNumber() == 5
                && d.severity().equals("ERROR")
                && d.message().contains("multiple")));
    }

    @Test
    public void acceptsCommentsAndNormalModalMoves() {
        GcodeReviewResult result = GcodeReviewService.review("job.nc", String.join("\n",
                "; comment",
                "G21",
                "G1 X10 Y10",
                "Y20"));

        assertTrue(result.diagnostics().isEmpty());
    }

    @Test
    public void doesNotTreatNonModalCodesAsMultipleMotionCodes() {
        GcodeReviewResult result = GcodeReviewService.review("job.nc", String.join("\n",
                "G53 G0 X10",
                "G28",
                "G10 L2 P1 X0",
                "G4 P1"));

        assertTrue(result.diagnostics().isEmpty());
    }
}
