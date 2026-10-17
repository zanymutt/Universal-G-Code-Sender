/*
    Copyright 2026 Joacim Breiler

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
package com.willwinder.universalgcodesender.services.interceptor;

import com.willwinder.universalgcodesender.IController;
import com.willwinder.universalgcodesender.gcode.GcodeStats;
import com.willwinder.universalgcodesender.model.BackendAPI;
import com.willwinder.universalgcodesender.model.Position;
import com.willwinder.universalgcodesender.model.UnitUtils;
import com.willwinder.universalgcodesender.types.GcodeCommand;
import com.willwinder.universalgcodesender.utils.ControllerUtils;
import org.junit.Test;
import org.mockito.MockedStatic;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.startsWith;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.mockStatic;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

public class ToolChangeInterceptorTest {

    @Test
    public void execute_shouldStripToolChangeWordAndSendToolSelection() throws Exception {
        ToolChangeInterceptor interceptor = new ToolChangeInterceptor(() -> true);
        IController controller = mock(IController.class);
        when(controller.createCommand(any())).thenReturn(new GcodeCommand(""));
        InterceptContext context = createContext(controller, "M6 T2");

        try (MockedStatic<ControllerUtils> ignored = mockStatic(ControllerUtils.class)) {
            interceptor.execute(context);
        }

        verify(controller).createCommand("T2");
    }

    @Test
    public void execute_shouldStripToolChangeWordWithoutSpace() throws Exception {
        ToolChangeInterceptor interceptor = new ToolChangeInterceptor(() -> true);
        IController controller = mock(IController.class);
        when(controller.createCommand(any())).thenReturn(new GcodeCommand(""));
        InterceptContext context = createContext(controller, "M6T1");

        try (MockedStatic<ControllerUtils> ignored = mockStatic(ControllerUtils.class)) {
            interceptor.execute(context);
        }

        verify(controller).createCommand("T1");
    }

    @Test
    public void execute_shouldStripPaddedToolChangeWordWithoutSpace() throws Exception {
        ToolChangeInterceptor interceptor = new ToolChangeInterceptor(() -> true);
        IController controller = mock(IController.class);
        when(controller.createCommand(any())).thenReturn(new GcodeCommand(""));
        InterceptContext context = createContext(controller, "M06T1");

        try (MockedStatic<ControllerUtils> ignored = mockStatic(ControllerUtils.class)) {
            interceptor.execute(context);
        }

        verify(controller).createCommand("T1");
    }

    @Test
    public void matches_shouldMatchToolChangeWithoutSpace() {
        ToolChangeInterceptor interceptor = new ToolChangeInterceptor(() -> true);

        boolean matches = interceptor.matches(new GcodeCommand("M6T1"));

        assertThat(matches).isTrue();
    }

    @Test
    public void matches_shouldNotMatchHigherMCode() {
        ToolChangeInterceptor interceptor = new ToolChangeInterceptor(() -> true);

        boolean matches = interceptor.matches(new GcodeCommand("M60"));

        assertThat(matches).isFalse();
    }

    @Test
    public void matches_shouldNotMatchAnM6InAComment() {
        ToolChangeInterceptor interceptor = new ToolChangeInterceptor(() -> true);

        // A comment-only line keeps its text in the original command string.
        assertThat(interceptor.matches(new GcodeCommand("", "( M6 tool change test - air only )", "", 1))).isFalse();
        assertThat(interceptor.matches(new GcodeCommand("( T1 M6 - 1/4 endmill )"))).isFalse();
        assertThat(interceptor.matches(new GcodeCommand("; M6 is next"))).isFalse();
        assertThat(interceptor.matches(new GcodeCommand("(M6) G0 X1"))).isFalse();
        assertThat(interceptor.matches(new GcodeCommand("G0 X1 (then M6 later"))).isFalse();
    }

    @Test
    public void matches_shouldMatchAToolChangeThatHasAComment() {
        ToolChangeInterceptor interceptor = new ToolChangeInterceptor(() -> true);

        assertThat(interceptor.matches(new GcodeCommand("T1 M6 (change tool)"))).isTrue();
        assertThat(interceptor.matches(new GcodeCommand("", "(flip) T1 M6 ; to the V-bit", "", 1))).isTrue();
        assertThat(interceptor.matches(new GcodeCommand("M6 T2 (unterminated"))).isTrue();
    }

    @Test
    public void matches_shouldNotMatchWhenDisabled() {
        ToolChangeInterceptor interceptor = new ToolChangeInterceptor(() -> false);

        boolean matches = interceptor.matches(new GcodeCommand("M6 T2"));

        assertThat(matches).isFalse();
    }

    @Test
    public void execute_shouldStripToolChangeWordWhenToolSelectionIsFirst() throws Exception {
        ToolChangeInterceptor interceptor = new ToolChangeInterceptor(() -> true);
        IController controller = mock(IController.class);
        when(controller.createCommand(any())).thenReturn(new GcodeCommand(""));
        InterceptContext context = createContext(controller, "T2 M6");

        try (MockedStatic<ControllerUtils> ignored = mockStatic(ControllerUtils.class)) {
            interceptor.execute(context);
        }

        verify(controller).createCommand("T2");
    }

    @Test
    public void execute_shouldNotSendToolSelectionWhenOnlyToolChangeWord() throws Exception {
        ToolChangeInterceptor interceptor = new ToolChangeInterceptor(() -> true);
        IController controller = mock(IController.class);
        when(controller.createCommand(any())).thenReturn(new GcodeCommand(""));
        InterceptContext context = createContext(controller, "M6");

        try (MockedStatic<ControllerUtils> ignored = mockStatic(ControllerUtils.class)) {
            interceptor.execute(context);
        }

        verify(controller, never()).createCommand("T");
        verify(controller, never()).createCommand(startsWith("T"));
    }

    private InterceptContext createContext(IController controller, String command) {
        GcodeStats gcodeStats = mock(GcodeStats.class);
        when(gcodeStats.getMax()).thenReturn(new Position(0, 0, 10, UnitUtils.Units.MM));

        BackendAPI backend = mock(BackendAPI.class);
        when(backend.getController()).thenReturn(controller);
        when(backend.getGcodeStats()).thenReturn(gcodeStats);

        CommandInterceptorService service = mock(CommandInterceptorService.class);
        return new InterceptContext(backend, new GcodeCommand(command), service);
    }
}
