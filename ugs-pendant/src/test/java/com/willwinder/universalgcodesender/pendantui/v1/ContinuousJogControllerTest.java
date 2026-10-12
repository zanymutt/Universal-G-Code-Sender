package com.willwinder.universalgcodesender.pendantui.v1;

import com.willwinder.universalgcodesender.listeners.ControllerState;
import com.willwinder.universalgcodesender.model.BackendAPI;
import com.willwinder.universalgcodesender.pendantui.v1.ContinuousJogController.Reason;
import com.willwinder.universalgcodesender.pendantui.v1.ContinuousJogController.Result;
import com.willwinder.universalgcodesender.services.JogService;
import com.willwinder.universalgcodesender.utils.ContinuousJogWorker;
import org.easymock.EasyMock;
import org.junit.Before;
import org.junit.Test;

import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.atomic.AtomicLong;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

public class ContinuousJogControllerTest {
    private static final long TIMEOUT_MS = 500;

    private BackendAPI backend;
    private JogService jogService;
    private ContinuousJogWorker worker;
    private final AtomicLong clock = new AtomicLong(1_000);
    private ContinuousJogController controller;

    @Before
    public void setUp() {
        backend = EasyMock.createMock(BackendAPI.class);
        jogService = EasyMock.createMock(JogService.class);
        worker = EasyMock.createMock(ContinuousJogWorker.class);
        ScheduledExecutorService scheduler = EasyMock.createNiceMock(ScheduledExecutorService.class);
        EasyMock.replay(scheduler);
        controller = new ContinuousJogController(backend, jogService, worker, scheduler, clock::get, TIMEOUT_MS);
    }

    private void replayAll() {
        EasyMock.replay(backend, jogService, worker);
    }

    private void verifyAll() {
        EasyMock.verify(backend, jogService, worker);
    }

    // The watchdog tick the real scheduler calls every 100 ms.
    private void tickWatchdog() {
        controller.checkWatchdog();
    }

    private void expectCanJog() {
        EasyMock.expect(backend.isConnected()).andReturn(true);
        EasyMock.expect(jogService.canJog()).andReturn(true);
    }

    @Test
    public void stoppingWhenNothingIsJoggingTouchesNothing() {
        // No expectations: any call into the worker or a jog cancel would fail the test.
        replayAll();
        Result result = controller.update(0, 0, 0);
        controller.stop();
        assertFalse(result.active());
        assertEquals(Reason.NONE, result.reason());
        assertFalse(controller.isActive());
        verifyAll();
    }

    @Test
    public void startsJoggingInTheRequestedDirection() {
        expectCanJog();
        worker.setDirection(1f, 0f, 0f);
        worker.update();
        replayAll();

        Result result = controller.update(1, 0, 0);

        assertTrue(result.active());
        assertTrue(controller.isActive());
        verifyAll();
    }

    @Test
    public void diagonalIsScaledToUnitLengthAndLongVectorsAreClamped() {
        expectCanJog();
        float diagonal = (float) (1 / Math.sqrt(2));
        worker.setDirection(diagonal, diagonal, 0f);
        worker.update();
        replayAll();

        controller.update(1, 1, 0);

        verifyAll();
    }

    @Test
    public void valuesOutsideRangeAreClamped() {
        expectCanJog();
        worker.setDirection(1f, 0f, 0f);
        worker.update();
        replayAll();

        controller.update(50, 0, 0);

        verifyAll();
    }

    @Test
    public void notConnectedIsRefusedWithAReason() {
        EasyMock.expect(backend.isConnected()).andReturn(false);
        replayAll();

        Result result = controller.update(1, 0, 0);

        assertFalse(result.active());
        assertEquals(Reason.NOT_CONNECTED, result.reason());
        verifyAll();
    }

    @Test
    public void aJobRunningIsRefusedAndNothingIsCancelled() {
        EasyMock.expect(backend.isConnected()).andReturn(true);
        EasyMock.expect(jogService.canJog()).andReturn(false);
        replayAll();

        Result result = controller.update(1, 0, 0);

        assertFalse(result.active());
        assertEquals(Reason.CANNOT_JOG, result.reason());
        // No worker call and no cancelJog: with some firmware cancelJog cancels the job.
        verifyAll();
    }

    @Test
    public void invalidNumbersStopInsteadOfJogging() {
        replayAll();

        Result result = controller.update(Double.NaN, Double.POSITIVE_INFINITY, 0);

        assertFalse(result.active());
        verifyAll();
    }

    @Test
    public void releasingStopsTheWorkerAndCancelsTheJogInProgress() {
        expectCanJog();
        worker.setDirection(0f, 1f, 0f);
        worker.update();
        worker.setDirection(0f, 0f, 0f);
        worker.stop();
        EasyMock.expect(backend.getControllerState()).andReturn(ControllerState.JOG);
        jogService.cancelJog();
        replayAll();

        controller.update(0, 1, 0);
        Result result = controller.update(0, 0, 0);

        assertFalse(result.active());
        assertFalse(controller.isActive());
        verifyAll();
    }

    @Test
    public void releasingDoesNotSendACancelWhenTheControllerIsNotJogging() {
        expectCanJog();
        worker.setDirection(0f, 1f, 0f);
        worker.update();
        worker.setDirection(0f, 0f, 0f);
        worker.stop();
        EasyMock.expect(backend.getControllerState()).andReturn(ControllerState.IDLE);
        replayAll();

        controller.update(0, 1, 0);
        controller.stop();

        verifyAll();
    }

    @Test
    public void heartbeatsKeepTheJogAliveAndSilenceStopsIt() {
        EasyMock.expect(backend.isConnected()).andReturn(true).times(2);
        EasyMock.expect(jogService.canJog()).andReturn(true).times(4);
        worker.setDirection(1f, 0f, 0f);
        EasyMock.expectLastCall().times(2);
        worker.update();
        EasyMock.expectLastCall().times(2);
        // The final stop:
        worker.setDirection(0f, 0f, 0f);
        worker.stop();
        EasyMock.expect(backend.getControllerState()).andReturn(ControllerState.JOG);
        jogService.cancelJog();
        replayAll();

        controller.update(1, 0, 0);
        clock.addAndGet(400);
        tickWatchdog();
        assertTrue("fresh enough", controller.isActive());

        controller.update(1, 0, 0); // heartbeat at +400
        clock.addAndGet(400);
        tickWatchdog();
        assertTrue("heartbeat reset the timeout", controller.isActive());

        clock.addAndGet(200); // 600 ms since the last heartbeat
        tickWatchdog();
        assertFalse("silence stopped it", controller.isActive());
        verifyAll();
    }

    @Test
    public void watchdogStopsAJogWhenTheControllerStopsBeingJoggable() {
        expectCanJog();
        worker.setDirection(1f, 0f, 0f);
        worker.update();
        EasyMock.expect(jogService.canJog()).andReturn(false);
        worker.setDirection(0f, 0f, 0f);
        worker.stop();
        EasyMock.expect(backend.getControllerState()).andReturn(ControllerState.HOLD);
        replayAll();

        controller.update(1, 0, 0);
        tickWatchdog();

        assertFalse(controller.isActive());
        verifyAll();
    }
}
