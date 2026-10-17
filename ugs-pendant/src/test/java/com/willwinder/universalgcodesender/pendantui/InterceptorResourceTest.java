package com.willwinder.universalgcodesender.pendantui;

import com.willwinder.universalgcodesender.model.BackendAPI;
import com.willwinder.universalgcodesender.pendantui.v1.model.InterceptorRespondRequest;
import com.willwinder.universalgcodesender.pendantui.v1.model.InterceptorStatus;
import com.willwinder.universalgcodesender.pendantui.v1.resources.InterceptorResource;
import com.willwinder.universalgcodesender.services.interceptor.CommandInterceptorService;
import com.willwinder.universalgcodesender.services.interceptor.InterceptorPrompt;
import com.willwinder.universalgcodesender.services.interceptor.InterceptorState;
import com.willwinder.universalgcodesender.services.interceptor.InterceptorStateEvent;
import com.willwinder.universalgcodesender.services.interceptor.UserResponse;
import com.willwinder.universalgcodesender.types.GcodeCommand;
import jakarta.ws.rs.BadRequestException;
import jakarta.ws.rs.ClientErrorException;
import org.easymock.EasyMock;
import org.junit.Test;

import java.util.List;
import java.util.Optional;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertNull;
import static org.junit.Assert.fail;

public class InterceptorResourceTest {

    private static final InterceptorPrompt CHANGE_TOOL =
            new InterceptorPrompt("toolChange.changeTool", List.of(UserResponse.CONTINUE, UserResponse.ABORT));

    private CommandInterceptorService service;
    private InterceptorResource resource;

    private void setUp(InterceptorState state, InterceptorPrompt prompt, GcodeCommand trigger, boolean active) throws Exception {
        service = EasyMock.createMock(CommandInterceptorService.class);
        EasyMock.expect(service.getState()).andReturn(state).anyTimes();
        EasyMock.expect(service.getCurrentPrompt()).andReturn(Optional.ofNullable(prompt)).anyTimes();
        EasyMock.expect(service.getTriggerCommand()).andReturn(Optional.ofNullable(trigger)).anyTimes();
        EasyMock.expect(service.isActive()).andReturn(active).anyTimes();

        BackendAPI backend = EasyMock.createMock(BackendAPI.class);
        EasyMock.expect(backend.getInterceptorService()).andReturn(service).anyTimes();
        EasyMock.replay(backend);

        resource = new InterceptorResource();
        var field = InterceptorResource.class.getDeclaredField("backendAPI");
        field.setAccessible(true);
        field.set(resource, backend);
    }

    private static GcodeCommand toolChange(String text) {
        return new GcodeCommand(text, text, "", 7);
    }

    @Test
    public void toolNumberIsReadFromTheCommandItself() {
        assertEquals(Integer.valueOf(1), InterceptorStatus.toolNumberOf("T1 M6"));
        assertEquals(Integer.valueOf(2), InterceptorStatus.toolNumberOf("M6 T2"));
        assertEquals(Integer.valueOf(3), InterceptorStatus.toolNumberOf("M06T3"));
        assertEquals(Integer.valueOf(5), InterceptorStatus.toolNumberOf("t05 m6"));
        assertEquals(Integer.valueOf(0), InterceptorStatus.toolNumberOf("T0 M6"));
        assertNull(InterceptorStatus.toolNumberOf("M6"));
        assertNull(InterceptorStatus.toolNumberOf("(T4 something) M6"));
        assertNull(InterceptorStatus.toolNumberOf("M6 ; T4"));
        assertNull(InterceptorStatus.toolNumberOf("G0 X10 ST1"));
        assertNull(InterceptorStatus.toolNumberOf(null));
    }

    @Test
    public void eventBecomesAStatusWithThePromptAndTheRequestedTool() {
        InterceptorStatus status = InterceptorStatus.of(new InterceptorStateEvent(
                InterceptorState.WAITING_FOR_USER, InterceptorState.RUNNING, null, toolChange("T2 M6"), CHANGE_TOOL));

        assertEquals("WAITING_FOR_USER", status.getState());
        assertEquals("RUNNING", status.getPreviousState());
        assertEquals("toolChange.changeTool", status.getPrompt().getStepId());
        assertEquals(List.of("CONTINUE", "ABORT"), status.getPrompt().getOptions());
        assertEquals("T2 M6", status.getTriggerCommand());
        assertEquals(Integer.valueOf(2), status.getToolNumber());
    }

    @Test
    public void anIdleInterceptorHasNoPromptOrTool() throws Exception {
        setUp(InterceptorState.INACTIVE, null, null, false);
        EasyMock.replay(service);

        InterceptorStatus status = resource.getStatus();

        assertEquals("INACTIVE", status.getState());
        assertNull(status.getPrompt());
        assertNull(status.getTriggerCommand());
        assertNull(status.getToolNumber());
    }

    @Test
    public void getStatusDescribesAWaitingToolChange() throws Exception {
        setUp(InterceptorState.WAITING_FOR_USER, CHANGE_TOOL, toolChange("T1 M6"), true);
        EasyMock.replay(service);

        InterceptorStatus status = resource.getStatus();

        assertEquals("WAITING_FOR_USER", status.getState());
        assertEquals(Integer.valueOf(1), status.getToolNumber());
        assertEquals("toolChange.changeTool", status.getPrompt().getStepId());
    }

    @Test
    public void continueIsPassedOnWhileWaiting() throws Exception {
        setUp(InterceptorState.WAITING_FOR_USER, CHANGE_TOOL, toolChange("T1 M6"), true);
        service.provideUserResponse(UserResponse.CONTINUE);
        EasyMock.expectLastCall().once();
        EasyMock.replay(service);

        resource.respond(new InterceptorRespondRequest(UserResponse.CONTINUE));

        EasyMock.verify(service);
    }

    @Test
    public void continueIsRefusedWhenNothingIsWaiting() throws Exception {
        setUp(InterceptorState.RUNNING, null, toolChange("T1 M6"), true);
        EasyMock.replay(service);

        try {
            resource.respond(new InterceptorRespondRequest(UserResponse.CONTINUE));
            fail("Expected a conflict");
        } catch (ClientErrorException e) {
            assertEquals(409, e.getResponse().getStatus());
        }
        EasyMock.verify(service);
    }

    @Test
    public void anAnswerTheStepDoesNotOfferIsABadRequest() throws Exception {
        setUp(InterceptorState.WAITING_FOR_USER, CHANGE_TOOL, toolChange("T1 M6"), true);
        EasyMock.replay(service);

        try {
            resource.respond(new InterceptorRespondRequest(UserResponse.SKIP));
            fail("Expected a bad request");
        } catch (BadRequestException e) {
            assertEquals(400, e.getResponse().getStatus());
        }
        EasyMock.verify(service);
    }

    @Test
    public void abortStopsAnActiveRoutineEvenWhenItFailed() throws Exception {
        setUp(InterceptorState.FAILED, null, null, true);
        service.abort();
        EasyMock.expectLastCall().once();
        EasyMock.replay(service);

        resource.respond(new InterceptorRespondRequest(UserResponse.ABORT));

        EasyMock.verify(service);
    }

    @Test
    public void abortWithNothingActiveIsAConflict() throws Exception {
        setUp(InterceptorState.INACTIVE, null, null, false);
        EasyMock.replay(service);

        try {
            resource.respond(new InterceptorRespondRequest(UserResponse.ABORT));
            fail("Expected a conflict");
        } catch (ClientErrorException e) {
            assertEquals(409, e.getResponse().getStatus());
        }
        EasyMock.verify(service);
    }

    @Test
    public void aMissingResponseIsABadRequest() throws Exception {
        setUp(InterceptorState.WAITING_FOR_USER, CHANGE_TOOL, toolChange("T1 M6"), true);
        EasyMock.replay(service);

        try {
            resource.respond(new InterceptorRespondRequest(null));
            fail("Expected a bad request");
        } catch (BadRequestException e) {
            assertEquals(400, e.getResponse().getStatus());
        }
    }
}
