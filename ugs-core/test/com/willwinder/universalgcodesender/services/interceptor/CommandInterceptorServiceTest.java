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
import com.willwinder.universalgcodesender.communicator.ICommunicator;
import com.willwinder.universalgcodesender.gcode.GcodeState;
import com.willwinder.universalgcodesender.listeners.ControllerState;
import com.willwinder.universalgcodesender.listeners.ControllerStatus;
import com.willwinder.universalgcodesender.model.BackendAPI;
import com.willwinder.universalgcodesender.model.UGSEventDispatcher;
import com.willwinder.universalgcodesender.types.GcodeCommand;
import com.willwinder.universalgcodesender.utils.IGcodeStreamReader;
import org.junit.Before;
import org.junit.Test;

import java.io.IOException;
import java.util.Iterator;
import java.util.List;
import java.util.concurrent.CopyOnWriteArrayList;
import java.util.concurrent.atomic.AtomicInteger;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.doAnswer;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

public class CommandInterceptorServiceTest {

    private CommandInterceptorService service;
    private final List<String> streamed = new CopyOnWriteArrayList<>();
    private final AtomicInteger interceptions = new AtomicInteger();
    private InterceptingGcodeStreamReader reader;

    @Before
    public void setUp() throws Exception {
        BackendAPI backend = mock(BackendAPI.class);
        IController controller = mock(IController.class);
        ICommunicator communicator = mock(ICommunicator.class);
        ControllerStatus status = mock(ControllerStatus.class);

        when(backend.getController()).thenReturn(controller);
        when(controller.getCommunicator()).thenReturn(communicator);
        when(communicator.hasCommandsAwaitingResponse()).thenReturn(false);
        when(status.getState()).thenReturn(ControllerState.IDLE);
        when(controller.getControllerStatus()).thenReturn(status);
        when(controller.getCurrentGcodeState()).thenReturn(new GcodeState());
        when(controller.createCommand(any())).thenAnswer(invocation -> new GcodeCommand(invocation.getArgument(0)));
        // Commands sent straight to the controller complete at once.
        doAnswer(invocation -> {
            GcodeCommand command = invocation.getArgument(0);
            command.setSent(true);
            command.setOk(true);
            command.setDone(true);
            return null;
        }).when(controller).sendCommandImmediately(any());
        // Like a real communicator, streaming keeps pulling commands from the stream until it has nothing
        // more to hand out right now (the controller's buffer is large enough for a short file).
        doAnswer(invocation -> {
            drain();
            return null;
        }).when(communicator).streamCommands();

        service = new CommandInterceptorService(backend, mock(UGSEventDispatcher.class));
        service.register(new CommandInterceptor() {
            @Override
            public boolean matches(GcodeCommand command) {
                return "M6".equals(command.getCommandString());
            }

            @Override
            public void execute(InterceptContext context) {
                interceptions.incrementAndGet();
            }
        });
    }

    private void drain() throws IOException {
        GcodeCommand command;
        while ((command = reader.getNextCommand()) != null) {
            streamed.add(command.getCommandString());
        }
    }

    private void waitFor(java.util.function.BooleanSupplier condition) throws InterruptedException {
        long deadline = System.currentTimeMillis() + 10_000;
        while (!condition.getAsBoolean() && System.currentTimeMillis() < deadline) {
            Thread.sleep(20);
        }
    }

    @Test
    public void aSecondToolChangeStreamedRightAfterTheFirstIsAlsoIntercepted() throws Exception {
        reader = (InterceptingGcodeStreamReader) service.beginJob(new ListReader("G0 X1", "M6", "G0 X2", "G0 X3", "M6", "G0 X4"));

        // The job starts: the stream hands out commands until it reaches the first tool change.
        drain();
        assertThat(streamed).containsExactly("G0 X1", "");

        // The file is short, so everything after the first tool change is handed out as soon as the
        // routine resumes the stream. The second tool change must still stop it.
        waitFor(() -> interceptions.get() == 2 && service.getState() == InterceptorState.INACTIVE);

        assertThat(interceptions.get()).isEqualTo(2);
        assertThat(streamed).doesNotContain("M6");
        assertThat(streamed).containsExactly("G0 X1", "", "G0 X2", "G0 X3", "", "G0 X4");
    }

    @Test
    public void aSingleToolChangeIsInterceptedOnceAndTheRestOfTheFileFollows() throws Exception {
        reader = (InterceptingGcodeStreamReader) service.beginJob(new ListReader("G0 X1", "M6", "G0 X2"));

        drain();
        waitFor(() -> interceptions.get() == 1 && service.getState() == InterceptorState.INACTIVE);

        assertThat(interceptions.get()).isEqualTo(1);
        assertThat(streamed).containsExactly("G0 X1", "", "G0 X2");
    }

    /** A stream over a fixed list of commands. */
    private static class ListReader implements IGcodeStreamReader {
        private final int total;
        private final Iterator<GcodeCommand> iterator;
        private int served;

        ListReader(String... commands) {
            this.total = commands.length;
            this.iterator = java.util.Arrays.stream(commands).map(GcodeCommand::new).iterator();
        }

        @Override
        public boolean ready() {
            return iterator.hasNext();
        }

        @Override
        public int getNumRows() {
            return total;
        }

        @Override
        public int getNumRowsRemaining() {
            return total - served;
        }

        @Override
        public GcodeCommand getNextCommand() {
            if (!iterator.hasNext()) {
                return null;
            }
            served++;
            return iterator.next();
        }

        @Override
        public void close() {
            // Nothing to release.
        }
    }
}
