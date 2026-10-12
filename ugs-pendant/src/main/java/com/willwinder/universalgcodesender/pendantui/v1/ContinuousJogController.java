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
package com.willwinder.universalgcodesender.pendantui.v1;

import com.willwinder.universalgcodesender.listeners.ControllerState;
import com.willwinder.universalgcodesender.model.BackendAPI;
import com.willwinder.universalgcodesender.services.JogService;
import com.willwinder.universalgcodesender.utils.ContinuousJogWorker;

import java.util.concurrent.Executors;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.ScheduledFuture;
import java.util.concurrent.TimeUnit;
import java.util.function.LongSupplier;

/**
 * Drives UGS's {@link ContinuousJogWorker} on behalf of a remote client (the dashboard).
 * <p>
 * The worker itself sends short jog segments acknowledged by the controller, so the
 * round trip that matters is controller-to-UGS, never client-to-UGS. The client only has
 * to say which way to go, and keep saying it: every update is a heartbeat. If the
 * heartbeats stop (a dropped link, a closed tab, a crashed browser) the jog is stopped
 * and cancelled after {@link #DEFAULT_TIMEOUT_MS}, so a lost client can never leave the
 * machine moving.
 * <p>
 * It also never starts a jog the on-screen jog buttons would refuse (not connected, a
 * job running, in alarm), stops one if the controller leaves IDLE/JOG, and only sends a
 * jog-cancel while the controller is actually in the JOG state - for firmware without a
 * real-time jog cancel that call falls back to cancelling the running job.
 */
public class ContinuousJogController {
    /** How long to keep jogging without a fresh update from the client. */
    public static final long DEFAULT_TIMEOUT_MS = 500;
    private static final long WATCHDOG_PERIOD_MS = 100;

    public enum Reason {
        /** Jogging (or, for a zero vector, stopped as asked). */
        NONE,
        NOT_CONNECTED,
        CANNOT_JOG
    }

    /** What an update resulted in. */
    public record Result(boolean active, Reason reason) {
    }

    private final BackendAPI backendAPI;
    private final JogService jogService;
    private final ContinuousJogWorker worker;
    private final ScheduledExecutorService scheduler;
    private final LongSupplier clockMillis;
    private final long timeoutMs;

    private boolean active;
    private long lastUpdateAt;
    private ScheduledFuture<?> watchdog;

    public ContinuousJogController(BackendAPI backendAPI, JogService jogService) {
        this(backendAPI, jogService, new ContinuousJogWorker(backendAPI, jogService),
                Executors.newSingleThreadScheduledExecutor(runnable -> {
                    Thread thread = new Thread(runnable, "continuous-jog-watchdog");
                    thread.setDaemon(true);
                    return thread;
                }),
                System::currentTimeMillis, DEFAULT_TIMEOUT_MS);
    }

    ContinuousJogController(BackendAPI backendAPI, JogService jogService, ContinuousJogWorker worker,
                            ScheduledExecutorService scheduler, LongSupplier clockMillis, long timeoutMs) {
        this.backendAPI = backendAPI;
        this.jogService = jogService;
        this.worker = worker;
        this.scheduler = scheduler;
        this.clockMillis = clockMillis;
        this.timeoutMs = timeoutMs;
    }

    /**
     * Sets the direction to jog in, each component -1..1 (the vector is clamped, and scaled
     * down to unit length so a diagonal isn't faster than a straight jog). A zero vector
     * stops. Calling this repeatedly with the same vector keeps the jog alive.
     */
    public synchronized Result update(double x, double y, double z) {
        x = sanitize(x);
        y = sanitize(y);
        z = sanitize(z);

        if (x == 0 && y == 0 && z == 0) {
            stopInternal();
            return new Result(false, Reason.NONE);
        }

        if (!backendAPI.isConnected()) {
            stopInternal();
            return new Result(false, Reason.NOT_CONNECTED);
        }
        if (!jogService.canJog()) {
            stopInternal();
            return new Result(false, Reason.CANNOT_JOG);
        }

        double length = Math.sqrt(x * x + y * y + z * z);
        if (length > 1.0) {
            x /= length;
            y /= length;
            z /= length;
        }

        lastUpdateAt = clockMillis.getAsLong();
        worker.setDirection((float) x, (float) y, (float) z);
        worker.update();
        if (!active) {
            active = true;
            startWatchdog();
        }
        return new Result(true, Reason.NONE);
    }

    /** Stops any continuous jog now. Safe to call at any time, including when nothing is jogging. */
    public synchronized void stop() {
        stopInternal();
    }

    public synchronized boolean isActive() {
        return active;
    }

    /** One watchdog tick. Package visible so tests can drive it without a real clock. */
    synchronized void checkWatchdog() {
        if (!active) {
            return;
        }
        boolean expired = clockMillis.getAsLong() - lastUpdateAt > timeoutMs;
        if (expired || !jogService.canJog()) {
            stopInternal();
        }
    }

    private void startWatchdog() {
        cancelWatchdog();
        watchdog = scheduler.scheduleAtFixedRate(this::checkWatchdog, WATCHDOG_PERIOD_MS, WATCHDOG_PERIOD_MS,
                TimeUnit.MILLISECONDS);
    }

    private void cancelWatchdog() {
        if (watchdog != null) {
            watchdog.cancel(false);
            watchdog = null;
        }
    }

    private void stopInternal() {
        if (!active) {
            // Nothing of ours is moving. Deliberately do not touch the worker or send a
            // cancel: for some firmware that would cancel an unrelated running job.
            return;
        }
        active = false;
        cancelWatchdog();
        worker.setDirection(0f, 0f, 0f);
        worker.stop();
        if (backendAPI.getControllerState() == ControllerState.JOG) {
            jogService.cancelJog();
        }
    }

    private static double sanitize(double value) {
        if (Double.isNaN(value) || Double.isInfinite(value)) {
            return 0;
        }
        return Math.max(-1.0, Math.min(1.0, value));
    }
}
